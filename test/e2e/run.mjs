import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Always install a fresh CLI. Never discover or fall back to the user's Harness.
async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-ops-next-e2e-'))
  const installation = path.join(root, 'installation')
  const home = path.join(root, 'home')
  const project = fileURLToPath(new URL('../../', import.meta.url))
  const version = '0.2.1-alpha.1'
  const keepTemp = process.env.DSH_E2E_KEEP_TMP === '1' && !process.env.CI
  console.warn(`Independent Harness test directory: ${root}`)
  const nodeDirectory = path.dirname(process.execPath)
  const npmCandidates = [
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ]
  const npmCli = (await Promise.all(npmCandidates.map(async candidate => access(candidate).then(() => candidate, () => undefined)))).find(Boolean)
  assert(npmCli, 'Node must include npm; no global Harness or package-manager fallback is allowed.')

  function run(argv, env = process.env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argv, { cwd: project, env, stdio: 'inherit' })
      const stop = () => child.kill('SIGTERM')
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        if (code === 0)
          resolve()
        else reject(new Error(`${path.basename(argv[0])} failed (${signal ?? code})`))
      })
    })
  }

  try {
    await access(path.join(project, `dist/upstream/runtime/${process.platform}-${process.arch}/dsh-ops-worker${process.platform === 'win32' ? '.exe' : ''}`))
    await mkdir(home, { recursive: true })
    await run([npmCli, 'install', '--prefix', installation, '--no-audit', '--no-fund', '--ignore-scripts', `@deepseek-ai/dsh@${version}`])
    const cli = path.join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    await access(cli)
    const manifest = JSON.parse(await readFile(path.join(installation, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
    assert.equal(manifest.version, version)
    assert((await realpath(cli)).startsWith(`${await realpath(installation)}${path.sep}`))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/i.test(key)))
    Object.assign(env, {
      DSH_E2E_ROOT: root,
      DSH_E2E_DSH_BIN: cli,
      DSH_E2E_DSH_VERSION: version,
      // Reuse only the installed Rust toolchain, not its writable user cache.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), '.rustup'),
      CARGO_HOME: path.join(root, 'cargo'),
      DSH_OPS_CARGO: path.join(process.env.CARGO_HOME ?? path.join(homedir(), '.cargo'), 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo'),
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(root, 'browsers'),
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData/Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData/Local'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local/share'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
    })
    if (process.platform === 'win32') {
      // A second test-owned runtime home preserves the default managed-only negative assertion.
      const runtimeHome = path.join(root, 'bash-runtime')
      const bashRoot = path.join(runtimeHome, 'dsh-ops/shells/bash/2.56.0.2')
      const confined = process.env.DSH_E2E_CONFINED_BASH_PATH
      if (confined) {
        env.DSH_E2E_CONFINED_BASH_PATH = confined
      }
      else {
        await run([path.join(project, 'dist/cli.js'), 'provision', '--bash', '--managed'], { ...env, DSH_HOME: runtimeHome })
        await run([path.join(project, 'scripts/build-bash-ipc.mjs'), '--bash-root', bashRoot], env)
        env.DSH_E2E_CONFINED_BASH_PATH = path.join(bashRoot, 'bin/bash.exe')
      }
      await access(env.DSH_E2E_CONFINED_BASH_PATH)
    }
    const playwright = fileURLToPath(import.meta.resolve('@playwright/test/cli'))
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH)
      await run([playwright, 'install', 'chromium'], env)
    await run([playwright, 'test', '--config', 'playwright.config.ts', ...process.argv.slice(2)], env)
  }
  finally {
    assert.equal(path.dirname(root), tmpdir(), 'Refuse to remove a non-test directory.')
    assert(path.basename(root).startsWith('dsh-ops-next-e2e-'))
    if (keepTemp)
      console.warn(`Kept only this test-owned directory for debugging: ${root}`)
    else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
