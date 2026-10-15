import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { findCargo } from '../source/dsh-ops/lib/rust.js'
import { NATIVE_TARGETS, prepareUpstream, PROJECT_ROOT, replaceOnce } from './prepare-upstream.mjs'

const PORTABILITY_TESTS = String.raw`
#[cfg(test)]
mod portability_tests {
    use super::*;
    #[test]
    fn path_separators_are_platform_specific() {
        let root = Path::new("root");
        let file = root.join("one\\two.txt");
        let expected = if cfg!(windows) { "one/two.txt" } else { "one\\two.txt" };
        assert_eq!(relative_display(root, &file), expected);
    }
    #[cfg(unix)]
    #[test]
    fn atomic_replace_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("dsh-ops-mode-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("executable");
        fs::write(&file, "before").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o751)).unwrap();
        atomic_write(&file, b"after").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"after");
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o751);
        fs::remove_dir_all(root).unwrap();
    }
}
`

/** Preserve Cargo's cache and source mtimes when staged bytes are unchanged. */
export function stageNative(root = PROJECT_ROOT) {
  const source = path.join(root, 'source/dsh-ops/native')
  const stage = path.join(root, '.cache/native')
  const files = ['Cargo.toml', 'Cargo.lock', ...fs.readdirSync(path.join(source, 'src'), { recursive: true }).map(file => path.join('src', file))]
  for (const file of files) {
    const from = path.join(source, file)
    const stat = fs.lstatSync(from)
    if (stat.isSymbolicLink())
      throw new Error(`Native build source must not be a symlink: ${from}`)
    if (!stat.isFile())
      continue
    let bytes = fs.readFileSync(from)
    if (file === path.join('src', 'file.rs')) {
      let text = bytes.toString('utf8').replace(/\r\n/g, '\n')
      text = replaceOnce(text, String.raw`    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")`, String.raw`    let display = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    if cfg!(windows) { display.replace('\\', "/") } else { display.into_owned() }`, file)
      text = replaceOnce(text, '    let parent = checked.parent;\n', '    #[cfg(unix)]\n    let permissions = checked.parent.symlink_metadata(&checked.name)?.permissions();\n    let parent = checked.parent;\n', file)
      text = replaceOnce(text, '    file.write_all(bytes)?;\n    file.sync_all()?;', '    file.write_all(bytes)?;\n    #[cfg(unix)]\n    file.set_permissions(permissions)?;\n    file.sync_all()?;', file)
      bytes = Buffer.from(text + PORTABILITY_TESTS)
    }
    const destination = path.join(stage, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination)))
      fs.writeFileSync(destination, bytes)
  }
  return stage
}

function run(file, args, options) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`${path.basename(file)} failed (${result.signal ?? result.status}): ${args.join(' ')}`)
}

function atomicWrite(file, bytes, mode) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, bytes, { mode, flag: 'wx' })
    fs.renameSync(temporary, file)
  }
  finally {
    fs.rmSync(temporary, { force: true })
  }
}

export function buildNative({ root = PROJECT_ROOT, target = `${process.platform}-${process.arch}`, offline = false } = {}) {
  if (!Object.hasOwn(NATIVE_TARGETS, target))
    throw new Error(`Unsupported native build target: ${target}`)
  const triple = NATIVE_TARGETS[target]
  const upstream = prepareUpstream(root)
  const stage = stageNative(root)
  const cargo = findCargo()
  run(cargo.file, ['build', '--release', '--locked', '--manifest-path', path.join(stage, 'Cargo.toml'), '--target', triple, '--target-dir', path.join(stage, 'target'), ...(offline ? ['--offline'] : [])], { cwd: stage, env: cargo.env })

  const name = target.startsWith('win32-') ? 'dsh-ops-worker.exe' : 'dsh-ops-worker'
  const temporaryRoot = fs.mkdtempSync(path.join(stage, 'distribution-'))
  try {
    fs.copyFileSync(path.join(upstream, 'package.json'), path.join(temporaryRoot, 'package.json'))
    // Reuse upstream's PE/ELF/Mach-O and SHA-256 checks, including foreign targets.
    run(process.execPath, [path.join(upstream, 'bin/native-runtime.mjs'), 'stage', '--root', temporaryRoot, '--platform', target, '--input', path.join(stage, 'target', triple, 'release')], { cwd: stage })
    const input = path.join(temporaryRoot, 'runtime', target)
    const destination = path.join(upstream, 'runtime', target)
    fs.mkdirSync(destination, { recursive: true })
    atomicWrite(path.join(destination, name), fs.readFileSync(path.join(input, name)), 0o755)
    atomicWrite(path.join(destination, 'provenance.json'), fs.readFileSync(path.join(input, 'provenance.json')), 0o644)
    return path.join(destination, name)
  }
  finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { target: { type: 'string' }, offline: { type: 'boolean' } } })
  console.log(`Built native worker: ${buildNative(values)}`)
}
