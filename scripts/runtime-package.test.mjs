import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { loadBumpConfig, versionBump } from 'bumpp'
import { expect, it, vi } from 'vitest'
import { prepareRuntimePackages } from '../build/package-runtime.mjs'
import bumpConfig, { syncNativeVersion } from '../bump.config.ts'
import manifest from '../package.json' with { type: 'json' }
import { executableName, resolveBinary, runtimeRoot } from '../src/ops/binary.js'
import { resolveWorker, workerName } from '../src/ops/ptc/runtime.js'
import * as shellPayloads from '../src/ops/shell-payloads.js'
import { bundledShellPath } from '../src/ops/shells.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value))

it('bumps only main, native platform packages and native crate, leaving shell payload pins unchanged', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const config = await loadBumpConfig(undefined, root)
  const packageFiles = ['package.json', ...['win32-x64', 'linux-x64', 'darwin-arm64'].map(target => `packages/${target}/package.json`)]
  const payloadFiles = shellPayloads.SHELL_UPSTREAM_PINS.map(pin => `packages/win32-x64-${pin.name}/package.json`)
  const files = [...packageFiles, ...payloadFiles, 'native/Cargo.toml', 'native/Cargo.lock']
  const originals = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]))
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-release-')))
  try {
    for (const file of files) {
      const destination = path.join(temporary, file)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(path.join(root, file), destination)
    }
    const [major, minor, patch] = manifest.version.split('.').map(Number)
    for (const increment of [1, 2]) {
      const nextVersion = `${major}.${minor}.${patch + increment}`
      const events = []
      const result = await versionBump({
        files: config.files,
        cwd: temporary,
        release: nextVersion,
        commit: false,
        tag: false,
        push: false,
        execute: ({ options: { cwd } }) => syncNativeVersion(cwd),
        install: false,
        ignoreScripts: true,
        noGitCheck: true,
        confirm: false,
        interface: false,
        printCommits: false,
        progress: ({ event }) => events.push(event),
      })
      expect(result).toMatchObject({ newVersion: nextVersion, commit: false, tag: false, skippedFiles: [] })
      expect(result.updatedFiles.sort()).toEqual(packageFiles.map(file => path.resolve(temporary, file)).sort())
      expect(new Set(events)).toEqual(new Set(['file updated']))
      for (const file of packageFiles) {
        expect(JSON.parse(fs.readFileSync(path.join(temporary, file), 'utf8'))).toEqual({ ...JSON.parse(originals.get(file)), version: nextVersion })
      }
      for (const file of payloadFiles)
        expect(fs.readFileSync(path.join(temporary, file), 'utf8')).toBe(originals.get(file))
      for (const file of ['native/Cargo.toml', 'native/Cargo.lock']) {
        const updated = fs.readFileSync(path.join(temporary, file), 'utf8')
        expect(updated.match(/name = "dsh-ops-core"\r?\nversion = "([^"]+)"/)?.[1]).toBe(nextVersion)
        expect(updated).toBe(originals.get(file).replace(/(name = "dsh-ops-core"\r?\nversion = ")[^"]+"/, (_, prefix) => `${prefix}${nextVersion}"`))
      }
    }
    const lockFile = path.join(temporary, 'native/Cargo.lock')
    const lock = fs.readFileSync(lockFile, 'utf8')
    const cargoFile = path.join(temporary, 'native/Cargo.toml')
    const cargo = fs.readFileSync(cargoFile, 'utf8')
    const packageFile = path.join(temporary, 'package.json')
    json(packageFile, { ...JSON.parse(fs.readFileSync(packageFile, 'utf8')), version: `${major}.${minor}.${patch + 3}` })
    for (const invalid of [lock.replace('name = "dsh-ops-core"', 'name = "not-our-crate"'), `${lock}\nname = "dsh-ops-core"\nversion = "0.0.0"\n`]) {
      fs.writeFileSync(lockFile, invalid)
      expect(() => syncNativeVersion(temporary)).toThrow('Expected exactly one dsh-ops-core version')
      expect(fs.readFileSync(cargoFile, 'utf8')).toBe(cargo)
      expect(fs.readFileSync(lockFile, 'utf8')).toBe(invalid)
    }
    for (const [file, original] of originals) expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(original)
  }
  finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

it('executes release preparation with native or JavaScript pnpm and stops on command failures', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-release-hook-')))
  try {
    fs.mkdirSync(path.join(temporary, 'native'))
    for (const file of ['package.json', 'native/Cargo.toml', 'native/Cargo.lock'])
      fs.copyFileSync(path.join(root, file), path.join(temporary, file))
    const context = { options: { cwd: temporary, commit: true } }
    vi.stubEnv('npm_execpath', undefined)
    expect(() => bumpConfig.execute(context)).toThrow('Run releases with pnpm release.')
    expect(spawnSync).not.toHaveBeenCalled()
    for (const pnpm of ['C:/Program Files/pnpm/pnpm.exe', '/opt/pnpm/pnpm', '/opt/pnpm/pnpm.cjs', '/opt/pnpm/pnpm.mjs', '/opt/pnpm/pnpm.js']) {
      vi.stubEnv('npm_execpath', pnpm)
      vi.mocked(spawnSync).mockReset().mockReturnValue({ status: 0 })
      bumpConfig.execute(context)
      const isScript = /\.[cm]?js$/.test(pnpm)
      expect(spawnSync.mock.calls).toEqual([
        ...[
          ['install', '--lockfile-only', '--ignore-scripts'],
          ['run', 'build'],
        ].map(args => [isScript ? process.execPath : pnpm, isScript ? [pnpm, ...args] : args, { cwd: temporary, stdio: 'inherit' }]),
        ['git', ['add', '--', 'dist'], { cwd: temporary, stdio: 'inherit' }],
      ])
    }
    vi.mocked(spawnSync).mockClear()
    bumpConfig.execute({ options: { cwd: temporary, commit: false } })
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(spawnSync.mock.calls.every(([command]) => command !== 'git')).toBe(true)
    const error = new Error('pnpm could not start')
    for (const [result, expected] of [
      [{ error }, error],
      [{ status: 1 }, 'Release preparation failed (1).'],
      [{ status: null, signal: 'SIGTERM' }, 'Release preparation failed (SIGTERM).'],
    ]) {
      for (const failedCommand of [0, 1, 2]) {
        vi.mocked(spawnSync).mockReset().mockReturnValue({ status: 0 })
        for (let command = 0; command < failedCommand; command++)
          vi.mocked(spawnSync).mockReturnValueOnce({ status: 0 })
        vi.mocked(spawnSync).mockReturnValueOnce(result)
        expect(() => bumpConfig.execute(context)).toThrow(expected)
        expect(spawnSync).toHaveBeenCalledTimes(failedCommand + 1)
      }
    }
  }
  finally {
    vi.unstubAllEnvs()
    vi.mocked(spawnSync).mockReset()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

it('stages new release chunks and removed old chunks without staging unrelated files', async () => {
  const { spawnSync: actualSpawnSync } = await vi.importActual('node:child_process')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-release-index-')))
  const git = (args) => {
    const result = actualSpawnSync('git', args, { cwd: temporary, encoding: 'utf8' })
    if (result.error)
      throw result.error
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  try {
    fs.mkdirSync(path.join(temporary, 'native'))
    fs.mkdirSync(path.join(temporary, 'dist'))
    for (const file of ['package.json', 'native/Cargo.toml', 'native/Cargo.lock'])
      fs.copyFileSync(path.join(root, file), path.join(temporary, file))
    fs.writeFileSync(path.join(temporary, 'dist/old-hash.js'), 'old chunk')
    git(['init', '--quiet'])
    git(['add', '--', 'dist'])
    git(['-c', 'core.hooksPath=disabled-hooks', '-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
    fs.writeFileSync(path.join(temporary, 'scratch.txt'), 'unrelated')
    vi.stubEnv('npm_execpath', '/fixture/pnpm')
    vi.mocked(spawnSync).mockReset().mockImplementation((command, args, options) => {
      if (command === 'git')
        return actualSpawnSync(command, args, options)
      if (args[0] === 'run') {
        fs.rmSync(path.join(temporary, 'dist/old-hash.js'))
        fs.writeFileSync(path.join(temporary, 'dist/new-hash.js'), 'new chunk')
      }
      return { status: 0 }
    })
    bumpConfig.execute({ options: { cwd: temporary, commit: true } })
    expect(git(['diff', '--cached', '--name-status']).split(/\r?\n/).sort()).toEqual([
      'A\tdist/new-hash.js',
      'D\tdist/old-hash.js',
    ])
    expect(git(['ls-files', '--others', '--exclude-standard'])).toContain('scratch.txt')
  }
  finally {
    vi.unstubAllEnvs()
    vi.mocked(spawnSync).mockReset()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

it('declares exact scoped platform dependencies and executable Unix runtimes', () => {
  const targets = ['darwin-arm64', 'linux-x64', 'win32-x64']
  expect(manifest.optionalDependencies).toEqual(Object.fromEntries(targets.map(target => [`@dshopslite/${target}`, 'workspace:*'])))
  for (const target of targets) {
    const [platform, arch] = target.split('-')
    const file = fileURLToPath(new URL(`../packages/${target}/package.json`, import.meta.url))
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(metadata).toMatchObject({ name: `@dshopslite/${target}`, version: manifest.version, os: [platform], cpu: [arch] })
    if (platform === 'win32') {
      expect(metadata.files).toEqual(['licenses', 'runtime'])
      expect(metadata.license).not.toContain('GPL-2.0-only')
    }
    // Unix consumers execute these directly; the E2E checks their packed modes.
    else {
      expect(metadata.publishConfig.executableFiles).toEqual([
        `./runtime/${target}/${workerName(platform)}`,
        `./runtime/${target}/${executableName(platform)}`,
      ])
    }
  }
})

it('runs the release workflow guard against exact artifacts and fails closed on unknown registry responses', async () => {
  const workflow = fs.readFileSync(fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const script = workflow.split('node --input-type=module <<\'NODE\'\n')[1].split('\n          NODE')[0].replace(/^ {10}/gm, '').replace(/^import .*\n/gm, '')
  const execute = vm.compileFunction(`return (async () => {\n${script}\n})()`, ['assert', 'execFileSync', 'readFileSync', 'readdirSync', 'writeFileSync', 'payloadExecutable', 'SHELL_UPSTREAM_PINS', 'process', 'fetch', 'AbortSignal', 'console', 'createHash', 'mkdirSync'])
  const pins = shellPayloads.SHELL_UPSTREAM_PINS.map(pin => ({ ...pin, executableSha256: createHash('sha256').update(`exe-${pin.name}`).digest('hex'), msysSha256: createHash('sha256').update('msys').digest('hex') }))
  const packages = [
    ...pins.map(pin => ({ name: pin.payloadPackage, version: pin.payloadVersion, pin })),
    ...['@dshopslite/win32-x64', '@dshopslite/linux-x64', '@dshopslite/darwin-arm64', 'dsh-ops-lite'].map(name => ({ name, version: manifest.version })),
  ].map(item => ({ ...item, file: `npm-packages/${item.name.replace(/^@/, '').replace('/', '-')}-${item.version}.tgz` }))
  const run = async ({ status = () => 404, corrupt = false, extra = false, existingIdentity = false, existingBytes = false } = {}) => {
    const write = vi.fn()
    const fetch = vi.fn(async (url) => {
      const item = packages.find(item => url.endsWith(`${encodeURIComponent(item.name)}/${item.version}`))
      expect(item).toBeDefined()
      return { status: status(item), json: async () => ({ name: existingIdentity ? 'wrong-name' : item.name, version: item.version }) }
    })
    const command = (file, args) => {
      if (file === 'npm') {
        expect(args).toEqual(['pack', expect.stringContaining('@dshopslite/win32-x64-'), '--registry=https://registry.npmjs.org', '--ignore-scripts', '--pack-destination', 'npm-existing-payloads'])
        return
      }
      expect(file).toBe('tar')
      const item = packages.find(item => path.posix.basename(item.file) === path.posix.basename(args[1]))
      if (args[2].endsWith('.exe'))
        return Buffer.from(existingBytes && args[1].startsWith('npm-existing-payloads/') ? 'tampered' : `exe-${item.pin.name}`)
      if (args[2].endsWith('.dll'))
        return Buffer.from('msys')
      expect(item).toBeDefined()
      if (args[2] === 'package/payload.json') {
        const { pin } = item
        return JSON.stringify({ kind: pin.name, target: 'win32-x64', version: pin.payloadVersion, executable: shellPayloads.payloadExecutable(pin), sha256: pin.executableSha256 })
      }
      return JSON.stringify({ name: item.name, version: corrupt && item.pin ? '0.0.0' : item.version, ...(item.pin ? { os: ['win32'], cpu: ['x64'] } : {}) })
    }
    const promise = execute(assert, command, () => JSON.stringify(manifest), () => [...packages.map(item => path.posix.basename(item.file)), ...(extra ? ['unexpected.tgz'] : [])], write, shellPayloads.payloadExecutable, pins, { env: { RELEASE_TAG: `v${manifest.version}` } }, fetch, AbortSignal, { log() {} }, createHash, vi.fn())
    return { promise, write, fetch }
  }
  for (const skipPins of [false, true]) {
    const { promise, write, fetch } = await run({ status: item => skipPins && item.pin ? 200 : 404 })
    await promise
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(write).toHaveBeenCalledWith('npm-publish-files.txt', `${packages.filter(item => !skipPins || !item.pin).map(item => item.file).join('\n')}\n`)
  }
  for (const status of [200, 401, 429, 500]) {
    const { promise, write } = await run({ status: item => item.pin && status === 200 ? 404 : status })
    await expect(promise).rejects.toThrow('Refuse to overwrite')
    expect(write).not.toHaveBeenCalled()
  }
  for (const invalid of [{ corrupt: true }, { extra: true }]) {
    const { promise, write, fetch } = await run(invalid)
    await expect(promise).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  }
  for (const invalid of [{ existingIdentity: true }, { existingBytes: true }]) {
    const { promise, write } = await run({ ...invalid, status: item => item.pin ? 200 : 404 })
    await expect(promise).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  }
  expect(workflow).toContain('npm publish "./$FILE" --provenance --access public --ignore-scripts')
})

it('declares independent upstream-pin shell packages with no install scripts or default dependencies', () => {
  for (const pin of shellPayloads.SHELL_UPSTREAM_PINS) {
    const file = fileURLToPath(new URL(`../packages/win32-x64-${pin.name}/package.json`, import.meta.url))
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(metadata).toMatchObject({ name: pin.payloadPackage, version: pin.payloadVersion, os: ['win32'], cpu: ['x64'], files: ['licenses', 'payload.json', 'vendor'] })
    expect(metadata.scripts).toBeUndefined()
    expect(manifest.optionalDependencies).not.toHaveProperty(pin.payloadPackage)
  }
  expect(shellPayloads.shellUpstreamPin({ kind: 'bash', platform: 'win32', arch: 'x64' }).payloadVersion).toBe('2.56.0-windows.2')
})

it('stages verified shell payloads separately while preserving native and IPC provenance guards', () => {
  const source = fileURLToPath(new URL('..', import.meta.url))
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-stage-')))
  const target = 'win32-x64'
  const dist = path.join(root, 'dist')
  const options = { root, platform: 'win32', arch: 'x64' }
  const lookup = vi.spyOn(shellPayloads, 'shellUpstreamPin')
  try {
    for (const file of ['package.json', ...[target, `${target}-bash`, `${target}-pwsh`].map(name => `packages/${name}/package.json`)]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.copyFileSync(path.join(source, file), path.join(root, file))
    }
    const native = fixture(dist, target)
    fs.mkdirSync(path.join(dist, 'licenses'))
    fs.writeFileSync(path.join(dist, 'licenses/NOTICE'), 'runtime license')
    const pins = shellPayloads.SHELL_UPSTREAM_PINS.map(pin => ({ ...pin }))
    for (const pin of pins) {
      const executable = path.join(dist, 'vendor', pin.name, target, pin.name === 'bash' ? 'bin/bash.exe' : 'pwsh.exe')
      fs.mkdirSync(path.dirname(executable), { recursive: true })
      fs.writeFileSync(executable, `synthetic-${pin.name}`)
      pin.executableSha256 = digest(executable)
    }
    lookup.mockImplementation(({ kind }) => pins.find(pin => pin.name === kind))
    const msys = path.join(dist, 'vendor/bash', target, 'usr/bin/msys-2.0.dll')
    fs.mkdirSync(path.dirname(msys), { recursive: true })
    fs.writeFileSync(msys, 'synthetic-msys')
    pins[0].msysSha256 = digest(msys)
    const proxies = path.join(dist, 'runtime', target, 'bash-ipc')
    fs.mkdirSync(proxies)
    for (const name of ['opsipc.dll', 'opsnt.dll']) fs.writeFileSync(path.join(proxies, name), name)
    const receipt = { platform: target, msysSha256: digest(msys), files: Object.fromEntries(['opsipc.dll', 'opsnt.dll'].map(name => [name, digest(path.join(proxies, name))])) }
    const receiptFile = path.join(proxies, 'provenance.json')
    json(receiptFile, receipt)
    const stale = path.join(root, 'packages', target, 'vendor/stale')
    fs.mkdirSync(stale, { recursive: true })
    prepareRuntimePackages(options)
    expect(fs.existsSync(path.dirname(stale))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'packages', target, 'runtime', target, 'dsh-ops-worker.exe'))).toEqual(fs.readFileSync(native.worker))
    for (const pin of pins) {
      const output = path.join(root, 'packages', `${target}-${pin.name}`)
      const metadata = JSON.parse(fs.readFileSync(path.join(output, 'payload.json'), 'utf8'))
      expect(metadata).toEqual({ kind: pin.name, target, version: pin.payloadVersion, executable: `vendor/${pin.name}/${target}/${pin.name === 'bash' ? 'bin/bash.exe' : 'pwsh.exe'}`, sha256: pin.executableSha256 })
      expect(digest(path.join(output, metadata.executable))).toBe(pin.executableSha256)
      expect(fs.existsSync(path.join(output, 'vendor', pin.name === 'bash' ? 'pwsh' : 'bash'))).toBe(false)
      expect(fs.readFileSync(path.join(output, 'licenses/NOTICE'), 'utf8')).toBe('runtime license')
    }
    json(receiptFile, { ...receipt, msysSha256: '0'.repeat(64) })
    expect(() => prepareRuntimePackages(options)).toThrow('Bash IPC MSYS provenance mismatch')
    json(receiptFile, { ...receipt, files: { ...receipt.files, 'opsipc.dll': '0'.repeat(64) } })
    expect(() => prepareRuntimePackages(options)).toThrow('Bash IPC provenance mismatch: opsipc.dll')
    json(receiptFile, receipt)
    const pin = pins[0]
    pin.msysSha256 = '0'.repeat(64)
    expect(() => prepareRuntimePackages(options)).toThrow('Bash IPC MSYS provenance mismatch')
    pin.msysSha256 = digest(msys)
    const original = pin.executableSha256
    pin.executableSha256 = '0'.repeat(64)
    expect(() => prepareRuntimePackages(options)).toThrow('Pinned bash executable mismatch')
    pin.executableSha256 = original
    const file = path.join(root, 'packages', `${target}-bash`, 'package.json')
    json(file, { ...JSON.parse(fs.readFileSync(file, 'utf8')), version: '0.0.0' })
    expect(() => prepareRuntimePackages(options)).toThrow('Shell payload package does not match the pin: bash')
  }
  finally {
    lookup.mockRestore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function fixture(directory, target) {
  const [platform] = target.split('-')
  const runtime = path.join(directory, 'runtime', target)
  fs.mkdirSync(runtime, { recursive: true })
  const worker = path.join(runtime, workerName(platform))
  const fastctx = path.join(runtime, platform === 'win32' ? 'fastctx.exe' : 'fastctx')
  fs.writeFileSync(worker, `worker-${target}`)
  fs.writeFileSync(fastctx, `fastctx-${target}`)
  json(path.join(runtime, 'provenance.json'), { target, version: manifest.version, executable: path.basename(worker), sha256: digest(worker) })
  json(path.join(runtime, 'fastctx.provenance.json'), { target, version: '0.2.6', executable: path.basename(fastctx), sha256: digest(fastctx) })
  return { worker, fastctx }
}

it('resolves exact platform packages without bypassing metadata, provenance or explicit worker selections', () => {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-packages-')))
  const originalPath = process.env.PATH
  try {
    for (const target of ['win32-x64', 'linux-x64', 'darwin-arm64']) {
      const [platform, arch] = target.split('-')
      const installation = path.join(temporary, target)
      const packageRoot = path.join(installation, 'dist')
      const name = `@dshopslite/${target}`
      const directory = path.join(installation, 'node_modules', name)
      fs.mkdirSync(directory, { recursive: true })
      fs.mkdirSync(packageRoot)
      json(path.join(installation, 'package.json'), { name: manifest.name, version: manifest.version, optionalDependencies: { [name]: manifest.version } })
      const metadata = { name, version: manifest.version, os: [platform], cpu: [arch] }
      json(path.join(directory, 'package.json'), metadata)
      const { worker, fastctx } = fixture(directory, target)
      const env = { PATH: path.join(packageRoot, 'ambient-bin'), DSH_HOME: path.join(packageRoot, 'ambient-home') }
      fs.mkdirSync(env.PATH, { recursive: true })
      fs.writeFileSync(path.join(env.PATH, path.basename(fastctx)), 'must-not-select-PATH')
      const managed = path.join(env.DSH_HOME, 'dsh-ops/bin')
      fs.mkdirSync(managed, { recursive: true })
      fs.writeFileSync(path.join(managed, path.basename(fastctx)), 'must-not-select-managed')
      const options = { packageRoot, platform, arch, env }
      const selections = () => [
        () => runtimeRoot(options),
        () => resolveWorker({}, options),
        () => resolveBinary(options),
        ...(platform === 'win32' ? [() => bundledShellPath({ kind: 'bash', bundleRoot: packageRoot, platform, arch })] : []),
      ]
      expect(runtimeRoot(options)).toBe(directory)
      expect(resolveWorker({}, options)).toBe(worker)
      expect(resolveBinary(options)).toMatchObject({ file: fastctx })
      if (platform === 'win32') {
        expect(bundledShellPath({ kind: 'bash', bundleRoot: packageRoot, platform, arch })).toBe(path.join(directory, 'vendor/bash', target, 'bin/bash.exe'))
        expect(bundledShellPath({ kind: 'pwsh', bundleRoot: packageRoot, platform, arch })).toBe(path.join(directory, 'vendor/pwsh', target, 'pwsh.exe'))
      }

      for (const invalid of [
        { name: 'wrong-runtime-package' },
        { version: '0.0.0' },
        { os: ['freebsd'] },
        { cpu: ['wrong-arch'] },
        { os: `not-${platform}` },
        { cpu: `not-${arch}` },
      ]) {
        json(path.join(directory, 'package.json'), { ...metadata, ...invalid })
        for (const select of selections()) expect(select).toThrow('metadata mismatch')
      }
      json(path.join(directory, 'package.json'), metadata)
      for (const [file, receiptName, select] of [
        [worker, 'provenance.json', () => resolveWorker({}, options)],
        [fastctx, 'fastctx.provenance.json', () => resolveBinary(options)],
      ]) {
        const receiptFile = path.join(path.dirname(file), receiptName)
        const original = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
        for (const invalid of [{ target: 'wrong-target' }, { version: '0.0.0' }, { executable: 'wrong-name' }, { sha256: '0'.repeat(64) }]) {
          json(receiptFile, { ...original, ...invalid })
          expect(select).toThrow('provenance mismatch')
        }
        fs.rmSync(receiptFile)
        expect(select).toThrow()
        json(receiptFile, original)
        const bytes = fs.readFileSync(file)
        fs.rmSync(file)
        expect(select).toThrow()
        fs.writeFileSync(file, bytes)
      }
      fs.appendFileSync(worker, 'tampered')
      expect(() => resolveWorker({}, options)).toThrow('provenance mismatch')
      expect(() => resolveWorker({ binaryPath: worker }, options)).toThrow('provenance mismatch')
      fs.appendFileSync(fastctx, 'tampered')
      expect(() => resolveBinary(options)).toThrow('provenance mismatch')

      fixture(directory, target)
      const explicit = path.join(packageRoot, 'selected-worker')
      fs.writeFileSync(explicit, 'authoritative-local-worker')
      json(path.join(directory, 'package.json'), { ...metadata, version: '0.0.0' })
      expect(resolveWorker({ binaryPath: explicit }, options)).toBe(explicit)
      expect(resolveWorker({}, { ...options, env: { ...env, DSH_OPS_WORKER_BIN: explicit } })).toBe(explicit)
      expect(resolveWorker({ binaryPath: explicit }, { ...options, env: { ...env, DSH_OPS_WORKER_BIN: `${explicit}-missing` } })).toBe(explicit)
      expect(resolveBinary({ ...options, binaryPath: explicit })).toMatchObject({ file: explicit, source: 'config.binaryPath' })
      expect(resolveBinary({ ...options, env: { ...env, DSH_OPS_FASTCTX_BIN: explicit } })).toMatchObject({ file: explicit, source: 'DSH_OPS_FASTCTX_BIN' })
      expect(resolveBinary({ ...options, binaryPath: explicit, env: { ...env, DSH_OPS_FASTCTX_BIN: `${explicit}-missing` } })).toMatchObject({ file: explicit, source: 'config.binaryPath' })
      json(path.join(directory, 'package.json'), metadata)
      expect(() => resolveWorker({ binaryPath: `${explicit}-missing` }, options)).toThrow('Native worker unavailable')
      expect(() => resolveWorker({}, { ...options, env: { ...env, DSH_OPS_WORKER_BIN: `${explicit}-missing` } })).toThrow('Native worker unavailable')
      expect(() => resolveWorker({ binaryPath: 'relative-worker' }, options)).toThrow('absolute path')
      expect(() => resolveBinary({ ...options, binaryPath: `${explicit}-missing` })).toThrow('config.binaryPath')
      expect(() => resolveBinary({ ...options, env: { ...env, DSH_OPS_FASTCTX_BIN: `${explicit}-missing` } })).toThrow('DSH_OPS_FASTCTX_BIN')

      // A local build remains installation-relative and wins over a broken npm package.
      const local = fixture(packageRoot, target)
      json(path.join(directory, 'package.json'), { ...metadata, version: '0.0.0' })
      expect(runtimeRoot(options)).toBe(packageRoot)
      expect(resolveWorker({}, options)).toBe(local.worker)
      expect(resolveBinary(options)).toMatchObject({ file: local.fastctx })
      fs.appendFileSync(local.worker, 'tampered')
      expect(() => resolveWorker({}, options)).toThrow('provenance mismatch')
      fs.appendFileSync(local.fastctx, 'tampered')
      expect(() => resolveBinary(options)).toThrow('provenance mismatch')
    }

    const missing = path.join(temporary, 'missing')
    const missingDist = path.join(missing, 'dist')
    fs.mkdirSync(missingDist, { recursive: true })
    json(path.join(missing, 'package.json'), { name: manifest.name, version: manifest.version })
    const env = { PATH: path.join(missing, 'bin'), DSH_HOME: path.join(missing, 'home') }
    for (const directory of [env.PATH, path.join(env.DSH_HOME, 'dsh-ops/bin')]) {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'fastctx'), 'must-not-fallback')
      fs.writeFileSync(path.join(directory, 'dsh-ops-worker'), 'must-not-fallback')
    }
    const options = { packageRoot: missingDist, platform: 'linux', arch: 'x64', env }
    expect(() => runtimeRoot(options)).toThrow()
    expect(() => resolveWorker({}, options)).toThrow()
    expect(() => resolveBinary(options)).toThrow()
    expect(() => runtimeRoot({ ...options, platform: 'freebsd' })).toThrow('Unsupported dsh-ops-lite runtime target freebsd-x64')
    expect(process.env.PATH).toBe(originalPath)
  }
  finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
