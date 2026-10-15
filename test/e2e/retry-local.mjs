import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

async function main() {
  const root = await realpath(process.argv[2])
  assert.equal(path.dirname(root), tmpdir())
  assert(path.basename(root).startsWith('dsh-ops-next-e2e-'))
  const cli = path.join(root, 'installation/node_modules/@deepseek-ai/dsh/lib/bin.js')
  await access(cli)
  const home = path.join(root, 'home')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/i.test(key)))
  Object.assign(env, {
    DSH_E2E_ROOT: root,
    DSH_E2E_DSH_BIN: cli,
    DSH_E2E_DSH_VERSION: '0.2.1-alpha.1',
    DSH_E2E_CONFINED_BASH_PATH: path.join(root, 'bash-runtime/dsh-ops/shells/bash/2.56.0.2/bin/bash.exe'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), '.rustup'),
    CARGO_HOME: path.join(root, 'cargo'),
    DSH_OPS_CARGO: path.join(process.env.CARGO_HOME ?? path.join(homedir(), '.cargo'), 'bin', 'cargo.exe'),
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  })
  const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test'], { env, stdio: 'inherit' })
  child.once('error', (error) => {
    throw error
  })
  child.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
