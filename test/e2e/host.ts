import type { TestInfo } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test as base } from '@playwright/test'

const project = fileURLToPath(new URL('../../', import.meta.url))
const cliVersion = '0.2.1-alpha.1'

interface ExecutionResult {
  isError: boolean
  value?: any
  content: { type: string, text?: string }[]
  error?: { code?: string, message?: string }
}

interface Schemas {
  schemas: { name: string, parameters: { properties?: Record<string, unknown> } }[]
  wireTools: string[]
  sections: { name: string, text: string }[]
}

export type Scope = 'native' | 'ptc' | 'inherited' | 'confined'

export interface Host {
  url: string
  workspace: string
  outside: string
  schemas: (scope?: Scope) => Promise<Schemas>
  call: (name: string, args?: Record<string, unknown>, scope?: Scope) => Promise<ExecutionResult>
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', reject)
      killer.once('exit', code => code === 0 || child.exitCode !== null ? resolve() : reject(new Error(`taskkill failed: ${code}`)))
    })
  }
  else {
    process.kill(-child.pid!, 'SIGTERM')
    await Promise.race([exited, delay(5000)])
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid!, 'SIGKILL')
  }
  await exited
}

async function createHost(info: TestInfo): Promise<Host & { stop: () => Promise<void> }> {
  const root = process.env.DSH_E2E_ROOT
  const cli = process.env.DSH_E2E_DSH_BIN
  const plugin = process.env.DSH_E2E_PLUGIN_ROOT
  assert(root && cli && plugin, 'Use pnpm run test:e2e; require an independent CLI and npm-installed packages, with no fallback.')
  assert(path.isAbsolute(root) && path.isAbsolute(cli) && path.isAbsolute(plugin), 'Require explicit absolute test paths.')
  assert.equal(path.dirname(await realpath(root)), await realpath(tmpdir()), 'Require a test-owned temporary root.')
  assert(path.basename(root).startsWith('dsh-ops-lite-e2e-'))
  const installation = path.join(root, 'installation')
  const expectedCli = path.join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  assert.equal(await realpath(cli), await realpath(expectedCli), 'Refuse an external or user-installed Harness.')
  const installed = JSON.parse(await readFile(path.join(installation, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')) as { version: string }
  assert.equal(installed.version, cliVersion)
  assert.equal(process.env.DSH_E2E_DSH_VERSION, cliVersion)
  assert.equal(await realpath(plugin), path.join(await realpath(installation), 'node_modules/dsh-ops-lite'), 'Refuse a checkout copy or externally built plugin.')
  const manifest = JSON.parse(await readFile(path.join(plugin, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-ops-lite')
  assert.equal(manifest.scripts?.install, undefined, 'The main package must not compile or download runtimes during installation.')
  const target = `${process.platform}-${process.arch}`
  const runtimeRoot = path.dirname(createRequire(path.join(plugin, 'package.json')).resolve(`dsh-ops-lite-${target}/package.json`))
  assert.equal(await realpath(runtimeRoot), path.join(await realpath(installation), `node_modules/dsh-ops-lite-${target}`))
  await access(path.join(plugin, 'dist/index.js'))
  await access(path.join(runtimeRoot, `runtime/${target}/dsh-ops-worker${process.platform === 'win32' ? '.exe' : ''}`))
  const scratch = await mkdtemp(path.join(root, 'host-'))
  const home = path.join(scratch, 'dsh-home')
  const profile = path.join(home, 'profiles/web')
  const workspace = path.join(scratch, 'workspace')
  // /tmp and os.tmpdir() are writable by the official Unix workspace-write contract.
  // Keep this canary outside those roots, under the checkout's test-owned artifacts.
  await mkdir(path.join(project, 'test-results'), { recursive: true })
  const outsideDirectory = await mkdtemp(path.join(project, 'test-results/e2e-boundary-'))
  const outside = path.join(outsideDirectory, 'canary.txt')
  await writeFile(outside, 'outside-unchanged\n')
  await mkdir(workspace, { recursive: true })
  await mkdir(info.outputPath(''), { recursive: true })
  await mkdir(path.join(profile, 'node_modules'), { recursive: true })
  // The installed plugin and CLI share one SDK tree; never copy checkout-built assets.
  await symlink(plugin, path.join(profile, 'node_modules/dsh-ops-lite'), process.platform === 'win32' ? 'junction' : 'dir')
  const token = randomBytes(24).toString('hex')
  const helper = path.join(profile, 'e2e-api.mjs')
  await cp(fileURLToPath(new URL('./api-plugin.mjs', import.meta.url)), helper)
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-ops-lite-e2e-profile',
    private: true,
    dependencies: { 'dsh-ops-lite': `file:${plugin}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-ops-lite'] } },
  }))
  await writeFile(path.join(profile, 'cordis.patch.yml'), [
    // The real official global implementation exercises SDK restrictions;
    // standard/ptc retain their real preset-owned registrations and execution guard.
    '- id: tool-fs',
    '  disabled: false',
    '- insert:',
    '    - id: e2e-api',
    `      name: ${JSON.stringify(helper.replaceAll('\\', '/'))}`,
    '      config:',
    `        token: ${JSON.stringify(token)}`,
    `        workspace: ${JSON.stringify(workspace)}`,
    '',
  ].join('\n'))
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  await writeFile(path.join(workspace, 'native.txt'), 'before-e2e\n')
  // FastCtx's supported idle override prevents its detached test-only daemon holding copied assets open after teardown.
  const env = { ...process.env, DSH_HOME: home, FASTCTX_TEST_RUNTIME_IDLE_MS: '500' }
  // Profile reconciliation may recreate webServer; keep its OS-selected port stable across reloads.
  const reservation = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      assert(address && typeof address === 'object')
      reservation.close(error => error ? reject(error) : resolve(address.port))
    })
  })
  assert(![3080, 3081].includes(port), 'Never bind a user GUI or development port.')
  const child = spawn(process.execPath, [cli, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: profile,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  let logs = ''
  let failed: Error | undefined
  child.once('error', (error) => {
    failed = error
  })
  const append = (chunk: Buffer): void => {
    logs += chunk.toString()
    logs = logs.slice(-2 * 1024 * 1024)
  }
  child.stdout!.on('data', append)
  child.stderr!.on('data', append)
  const finish = async (): Promise<void> => {
    await stop(child)
    await writeFile(info.outputPath('dsh-web.log'), logs.replaceAll(token, '[redacted]'))
    await info.attach('Harness host log', { path: info.outputPath('dsh-web.log'), contentType: 'text/plain' })
    assert.equal(path.dirname(outsideDirectory), path.join(project, 'test-results'))
    assert(path.basename(outsideDirectory).startsWith('e2e-boundary-'))
    await rm(outsideDirectory, { recursive: true, force: true })
  }
  try {
    let launch: string | undefined
    const deadline = Date.now() + 90_000
    while (!launch && Date.now() < deadline) {
      if (failed)
        throw failed
      if (child.exitCode !== null)
        throw new Error(`Isolated Harness exited ${child.exitCode}:\n${logs}`)
      launch = /http:\/\/127\.0\.0\.1:\d+(?:\/[\w?=&#./%-]*)?/u.exec(logs)?.[0]
      if (!launch)
        await delay(100)
    }
    assert(launch, `Isolated Harness readiness timed out:\n${logs}`)
    const url = new URL(launch)
    assert.notEqual(url.port, '3080', 'Never attach to the user GUI.')
    const request = async <T>(route: string, body?: unknown): Promise<T> => {
      const response = await fetch(new URL(route, url.origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'authorization': token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(70_000),
      })
      if (response.status !== 200)
        throw new Error(`Test API: ${response.status}: ${await response.text()}`)
      return response.json() as Promise<T>
    }
    return {
      url: launch,
      workspace,
      outside,
      schemas: (scope = 'native') => request(`/__e2e/schemas?scope=${scope}`),
      call: (name, args = {}, scope = 'native') => request('/__e2e/call', { name, arguments: args, scope }),
      stop: finish,
    }
  }
  catch (error) {
    await finish()
    throw error
  }
}

export const test = base.extend<{ host: Host }>({
  // Playwright requires an object-destructured first parameter for fixture discovery.
  // eslint-disable-next-line no-empty-pattern
  host: async ({}, use, info) => {
    const host = await createHost(info)
    try {
      await use(host)
    }
    finally {
      await host.stop()
    }
  },
})
export { expect } from '@playwright/test'
