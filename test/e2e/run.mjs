import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Always install a fresh CLI. Never discover or fall back to the user's Harness.
async function main() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-ops-next-e2e-')))
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DSH_|npm_config_(?:cache|userconfig)$)/i.test(key)))
  Object.assign(env, {
    DSH_E2E_ROOT: root,
    DSH_E2E_DSH_VERSION: version,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(root, 'browsers'),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(home, '.npmrc'),
  })

  function run(argv) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argv, { cwd: project, env, stdio: 'inherit', detached: process.platform !== 'win32' })
      const stop = () => {
        if (process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('error', reject)
        else process.kill(-child.pid, 'SIGTERM')
      }
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
    await access(path.join(project, `dist/runtime/${process.platform}-${process.arch}/dsh-ops-worker${process.platform === 'win32' ? '.exe' : ''}`))
    await mkdir(home, { recursive: true })
    await run([npmCli, 'install', '--prefix', installation, '--no-audit', '--no-fund', '--ignore-scripts', `@deepseek-ai/dsh@${version}`])
    const cli = path.join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    await access(cli)
    const manifest = JSON.parse(await readFile(path.join(installation, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
    assert.equal(manifest.version, version)
    assert((await realpath(cli)).startsWith(`${await realpath(installation)}${path.sep}`))
    env.DSH_E2E_DSH_BIN = cli
    const playwright = fileURLToPath(import.meta.resolve('@playwright/test/cli'))
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH)
      await run([playwright, 'install', 'chromium'])
    await run([playwright, 'test', '--config', 'playwright.config.ts', ...process.argv.slice(2)])
  }
  finally {
    assert.equal(path.dirname(root), await realpath(tmpdir()), 'Refuse to remove a non-test directory.')
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
