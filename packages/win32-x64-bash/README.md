# @dshopslite/win32-x64-bash

Pinned Git for Windows PortableGit shell payload for dsh-ops-lite. This package is installed on demand by dsh-ops-lite's installation provisioner, not as a default native-runtime dependency. It has no install scripts.

The npm version `2.56.0-windows.2` encodes upstream PortableGit `2.56.0.2` (release `v2.56.0.windows.2`). Payload versions track upstream pins independently of dsh-ops-lite releases.

`vendor/bash/win32-x64/bin/bash.exe` retains its PortableGit tree. `payload.json` records the kind, target, payload version, executable path relative to this package, and executable SHA256. Upstream licenses and notices remain in the vendor tree; additional runtime notices are in `licenses/`.

Build from the repository with `pnpm build`, then `node build/package-runtime.mjs` on Windows x64. Pack with `pnpm --filter @dshopslite/win32-x64-bash --config.ignore-scripts=true pack`. Download and checksum pins are shared with the install-time verifier.
