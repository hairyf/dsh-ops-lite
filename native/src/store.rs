//! Bounded persistent records. Immutable generations avoid platform-specific replace semantics.
use crate::{
    contract::{Failure, Result},
    paths::STORE,
};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use fs2::FileExt;
use serde::{Serialize, de::DeserializeOwned};
use std::io::{Read, Write};

pub const MAX_RECORD: usize = 2 * 1024 * 1024;
const MAX_STORE: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 4096;
pub struct Store {
    pub dir: Dir,
    _lock: std::fs::File,
    read_only: bool,
}
impl Store {
    pub fn open(root: &Dir, read_only: bool) -> Result<Self> {
        if !read_only {
            match root.create_dir(STORE) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.into()),
            }
        }
        let dir = root.open_dir_nofollow(STORE)?;
        let mut opts = OpenOptions::new();
        opts.read(true)
            .write(!read_only)
            .create(!read_only)
            .follow(FollowSymlinks::No);
        let lock = dir.open_with("lock", &opts)?.into_std();
        let locked = if read_only {
            FileExt::try_lock_shared(&lock)
        } else {
            FileExt::try_lock_exclusive(&lock)
        };
        locked
            .map_err(|_| Failure::new("JOB_BUSY", "Another operation owns this workspace store"))?;
        Ok(Self {
            dir,
            _lock: lock,
            read_only,
        })
    }
    pub fn validate_id(id: &str) -> Result<()> {
        if id.len() != 38
            || !id.is_ascii()
            || !(id.starts_with("j-") || id.starts_with("r-"))
            || uuid::Uuid::parse_str(&id[2..]).is_err()
        {
            return Err(Failure::new("INVALID_ARGUMENT", "Invalid reference ID"));
        }
        Ok(())
    }
    pub fn latest(&self, id: &str) -> Result<(String, u32)> {
        Self::validate_id(id)?;
        let mut best = None;
        for entry in self.dir.entries()? {
            let n = entry?.file_name();
            let n = n.to_string_lossy();
            if let Some(suffix) = n.strip_prefix(&format!("{id}."))
                && let Some(nr) = suffix
                    .strip_suffix(".json")
                    .and_then(|s| s.parse::<u32>().ok())
                && best.as_ref().is_none_or(|(_, old)| nr > *old)
            {
                best = Some((n.into_owned(), nr));
            }
        }
        best.ok_or_else(|| Failure::new("NOT_FOUND", "Reference missing or expired"))
    }
    pub fn read<T: DeserializeOwned>(&self, id: &str) -> Result<T> {
        let (name, _) = self.latest(id)?;
        let mut opts = OpenOptions::new();
        opts.read(true).follow(FollowSymlinks::No);
        let f = self.dir.open_with(name, &opts)?;
        let mut bytes = Vec::new();
        f.take((MAX_RECORD + 1) as u64).read_to_end(&mut bytes)?;
        if bytes.len() > MAX_RECORD {
            return Err(Failure::new("OUTPUT_LIMIT", "Record exceeds byte budget"));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
    pub fn save<T: Serialize>(&self, id: &str, value: &T) -> Result<()> {
        if self.read_only {
            return Err(Failure::new("POLICY_DENIED", "Read-only result store"));
        }
        Self::validate_id(id)?;
        let bytes = serde_json::to_vec(value)?;
        if bytes.len() > MAX_RECORD {
            return Err(Failure::new("OUTPUT_LIMIT", "Record exceeds byte budget"));
        }
        let previous = match self.latest(id) {
            Ok((_, n)) => Some(n),
            Err(e) if e.code == "NOT_FOUND" => None,
            Err(e) => return Err(e),
        };
        // Keep the latest committed generation and its predecessor. Each contains the
        // complete per-item audit; retaining every whole snapshot would be quadratic.
        for entry in self.dir.entries()? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(nr) = name
                .strip_prefix(&format!("{id}."))
                .and_then(|s| s.strip_suffix(".json"))
                .and_then(|s| s.parse::<u32>().ok())
                && previous.is_some_and(|latest| nr < latest.saturating_sub(1))
            {
                self.dir.remove_file(name.as_ref())?;
            }
        }
        let mut size = 0;
        let mut count = 0;
        for entry in self.dir.entries()? {
            let e = entry?;
            size += e.metadata()?.len();
            count += 1;
        }
        if size + bytes.len() as u64 > MAX_STORE || count >= MAX_FILES {
            return Err(Failure::new(
                "OUTPUT_LIMIT",
                "Audit store quota exhausted; archive completed records before continuing",
            ));
        }
        let generation = previous.map_or(Ok(0), |n| {
            n.checked_add(1)
                .ok_or_else(|| Failure::new("OUTPUT_LIMIT", "Generation counter exhausted"))
        })?;
        // Write to a unique incomplete file; a crash here cannot replace the last valid generation.
        let temporary = format!("{id}.{}.tmp", uuid::Uuid::new_v4());
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut f = self.dir.open_with(&temporary, &options)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        drop(f);
        self.dir
            .rename(&temporary, &self.dir, format!("{id}.{generation:06}.json"))?;
        // Reopen the same directory: a duplicated O_PATH handle cannot be fsynced.
        #[cfg(unix)]
        self.dir.open(".")?.sync_all()?;
        Ok(())
    }
    pub fn release(&self, id: &str) -> Result<()> {
        if self.read_only {
            return Err(Failure::new("POLICY_DENIED", "Read-only result store"));
        }
        Self::validate_id(id)?;
        if !id.starts_with("r-") {
            return Err(Failure::new(
                "POLICY_DENIED",
                "Job audit records cannot be released by this tool",
            ));
        }
        let prefix = format!("{id}.");
        for entry in self.dir.entries()? {
            let n = entry?.file_name();
            if n.to_string_lossy().starts_with(&prefix) {
                self.dir.remove_file(n)?;
            }
        }
        Ok(())
    }
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::Store;
    use cap_std::{ambient_authority, fs::Dir};
    use serde_json::{Value, json};
    use std::fs;

    #[test]
    fn save_reads_committed_generations() {
        let directory = std::env::temp_dir().join(format!("dsh-ops-store-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let directory = fs::canonicalize(directory).unwrap();
        let result: crate::contract::Result<()> = (|| {
            let root = Dir::open_ambient_dir(&directory, ambient_authority())?;
            let store = Store::open(&root, false)?;
            let id = format!("r-{}", uuid::Uuid::new_v4());
            store.save(&id, &json!({"generation": 0}))?;
            assert_eq!(store.read::<Value>(&id)?, json!({"generation": 0}));
            store.save(&id, &json!({"generation": 1}))?;
            assert_eq!(store.latest(&id)?.1, 1);
            assert_eq!(store.read::<Value>(&id)?, json!({"generation": 1}));
            Ok(())
        })();
        fs::remove_dir_all(directory).unwrap();
        result.unwrap();
    }
}
