# @dshopslite/win32-x64-pwsh

Pinned PowerShell `7.6.6` payload for dsh-ops-lite on Windows x64. This package is installed on demand by dsh-ops-lite's installation provisioner, not as a default native-runtime dependency. It has no install scripts. Payload versions track upstream pins independently of dsh-ops-lite releases.

`vendor/pwsh/win32-x64/pwsh.exe` retains its portable PowerShell tree. `payload.json` records the kind, target, payload version, executable path relative to this package, and executable SHA256. Upstream licenses and notices remain in the vendor tree; additional runtime notices are in `licenses/`.

Build from the repository with `pnpm build`, then `node build/package-runtime.mjs` on Windows x64. Pack with `pnpm --filter @dshopslite/win32-x64-pwsh --config.ignore-scripts=true pack`. Download and checksum pins are shared with the install-time verifier.
