import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import { confinedBash } from '../src/ops/bash-ipc.js'
import { provisionShells } from '../src/ops/provision.js'
import { managedShell, managedShellDirectory, payloadExecutable, SHELL_PROVISION_COMMAND, SHELL_UPSTREAM_PINS, shellFileSha256, shellStoreRoot, shellUpstreamPin, systemShell, validateLocalShell, validateShellPayload } from '../src/ops/shell-payloads.js'
import { bundledShellPath, resolveShells } from '../src/ops/shells.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const temporary = []
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value))
function fixture() {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-provision-')))
  temporary.push(directory)
  const env = { 'DSH_HOME': path.join(directory, 'home'), 'PATH': '', 'ProgramFiles': path.join(directory, 'programs'), 'ProgramFiles(x86)': path.join(directory, 'programs-x86') }
  return { directory, env, platform: 'win32', arch: 'x64', warn: vi.fn() }
}
function executable(file, content = 'local executable') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}
function packageFixture(directory, pin) {
  const file = executable(path.join(directory, payloadExecutable(pin)), 'fixture shell bytes')
  const metadata = { name: pin.payloadPackage, version: pin.payloadVersion, os: [pin.platform], cpu: [pin.arch] }
  const payload = { kind: pin.name, target: `${pin.platform}-${pin.arch}`, version: pin.payloadVersion, executable: payloadExecutable(pin), sha256: pin.executableSha256 }
  json(path.join(directory, 'package.json'), metadata)
  json(path.join(directory, 'payload.json'), payload)
  return { file, metadata, payload }
}

afterEach(() => {
  vi.mocked(spawnSync).mockReset()
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

it('shares exact independent npm pins and published source-only installer/bin paths', () => {
  expect(SHELL_UPSTREAM_PINS.map(pin => [pin.payloadPackage, pin.payloadVersion])).toEqual([
    ['@dshopslite/win32-x64-bash', '2.56.0-windows.2'],
    ['@dshopslite/win32-x64-pwsh', '7.6.6'],
  ])
  expect(shellUpstreamPin({ kind: 'bash', platform: 'linux', arch: 'x64' })).toBeUndefined()
  expect(manifest.scripts.postinstall).toBe('node scripts/provision-shells.mjs --postinstall')
  expect(manifest.bin['dsh-ops-provision-shells']).toBe('./scripts/provision-shells.mjs')
  expect(SHELL_PROVISION_COMMAND).toBe('npx --package dsh-ops-lite dsh-ops-provision-shells')
  for (const file of ['scripts/provision-shells.mjs', 'src/ops/shell-payloads.js', 'src/ops/provision.js'])
    expect(manifest.files).toContain(file)
  expect(shellStoreRoot({ env: {} })).toBe(path.join(os.homedir(), '.dsh/dsh-ops/shells'))
  expect(() => shellStoreRoot({ env: { DSH_HOME: 'relative-home' } })).toThrow('absolute path')
})

it('skips without writes or npm for selection/platform controls and rejects invalid selection', () => {
  const options = fixture()
  for (const changes of [
    { env: { ...options.env, DSH_OPS_SKIP_SHELL_PAYLOAD: '1', DSH_OPS_SHELLS: 'invalid' } },
    { env: { ...options.env, DSH_OPS_SHELLS: 'none' } },
    { platform: 'linux' },
    { arch: 'arm64' },
  ]) expect(provisionShells({ ...options, ...changes })).toEqual({ failed: false, shells: [] })
  expect(fs.existsSync(options.env.DSH_HOME)).toBe(false)
  expect(() => provisionShells({ ...options, env: { ...options.env, DSH_OPS_SHELLS: 'invalid' } })).toThrow('DSH_OPS_SHELLS')
  expect(spawnSync).not.toHaveBeenCalled()
})

it('persists local discovery, avoids downloads, and requires explicit runtime authorization even without PATH', () => {
  const options = fixture()
  const bin = path.join(options.directory, 'local shells')
  const bash = executable(path.join(bin, 'bash.exe'))
  const pwsh = executable(path.join(bin, 'pwsh.exe'))
  options.env.PATH = bin
  options.env.DSH_OPS_SHELLS = 'pwsh'
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'PowerShell 7.6.6\n' })
  const result = provisionShells(options)
  expect(result).toMatchObject({ failed: false, shells: [{ kind: 'pwsh', source: 'local', file: pwsh, detectedVersion: '7.6.6' }] })
  expect(options.warn).toHaveBeenCalledWith(expect.stringContaining('does not grant that permission'))
  expect(spawnSync).toHaveBeenCalledExactlyOnceWith(pwsh, ['-NoLogo', '-NoProfile', '--version'], expect.objectContaining({ timeout: 5_000, maxBuffer: 64_000 }))
  const runtime = { ...options, bundleRoot: path.join(options.directory, 'missing-package'), env: { ...options.env, PATH: '' } }
  for (const kind of ['pwsh']) {
    const directory = managedShellDirectory({ kind, ...options })
    expect(directory).toBe(path.join(options.env.DSH_HOME, 'dsh-ops/shells', kind, shellUpstreamPin({ kind, ...options }).payloadVersion))
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, '.provisioned.json'), 'utf8'))
    expect(receipt).toMatchObject({ source: 'local', file: pwsh, detectedVersion: '7.6.6', sha256: shellFileSha256(pwsh) })
    expect(managedShell({ kind, ...runtime })).toBeUndefined()
    expect(resolveShells({ allowSystemShellFallback: false }, runtime)[kind].available).toBe(false)
    expect(resolveShells({ allowSystemShellFallback: true }, runtime)[kind]).toMatchObject({ available: true, source: 'local', file: receipt.file })
  }
  expect(resolveShells({ bashPath: `${bash}-missing`, allowSystemShellFallback: true }, runtime).bash).toMatchObject({ available: false, source: 'config' })
  expect(resolveShells({ bashPath: bash, allowSystemShellFallback: false }, runtime).bash).toMatchObject({ available: true, source: 'config' })
  expect(() => confinedBash(bash, { platform: 'win32', home: options.env.DSH_HOME })).toThrow('supported MSYS payload layout')
  const receiptFile = path.join(managedShellDirectory({ kind: 'pwsh', ...options }), '.provisioned.json')
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  // A local executable cannot become managed authority by editing its receipt.
  json(receiptFile, { ...receipt, source: 'payload' })
  expect(managedShell({ kind: 'pwsh', ...runtime, allowLocal: true })).toBeUndefined()
  json(receiptFile, receipt)
  fs.appendFileSync(pwsh, 'tampered')
  expect(managedShell({ kind: 'pwsh', ...runtime, allowLocal: true })).toBeUndefined()
  expect(resolveShells({ allowSystemShellFallback: true }, runtime).pwsh.available).toBe(false)
  // Runtime verification is read-only; only install-time discovery executed --version.
  expect(spawnSync).toHaveBeenCalledTimes(1)
})

it('verifies package identity, fixed executable path, and real SHA256 instead of trusting payload metadata', () => {
  const options = fixture()
  const base = shellUpstreamPin({ kind: 'bash', ...options })
  const pin = { ...base, executableSha256: createHash('sha256').update('fixture shell bytes').digest('hex'), msysSha256: createHash('sha256').update('fixture msys bytes').digest('hex') }
  const directory = path.join(options.directory, 'payload')
  const { file, metadata, payload } = packageFixture(directory, pin)
  const dll = executable(path.resolve(path.dirname(file), '../usr/bin/msys-2.0.dll'), 'fixture msys bytes')
  expect(validateShellPayload(directory, pin)).toBe(file)
  fs.appendFileSync(dll, 'tampered')
  expect(() => validateShellPayload(directory, pin)).toThrow('MSYS SHA256 mismatch')
  fs.writeFileSync(dll, 'fixture msys bytes')
  for (const invalid of [{ name: 'wrong' }, { version: '0.0.0' }, { os: 'win32' }, { cpu: ['arm64'] }]) {
    json(path.join(directory, 'package.json'), { ...metadata, ...invalid })
    expect(() => validateShellPayload(directory, pin)).toThrow('metadata mismatch')
  }
  json(path.join(directory, 'package.json'), metadata)
  for (const invalid of [{ kind: 'pwsh' }, { target: 'linux-x64' }, { version: '0.0.0' }, { executable: '../../outside.exe' }, { sha256: '0'.repeat(64) }]) {
    json(path.join(directory, 'payload.json'), { ...payload, ...invalid })
    expect(() => validateShellPayload(directory, pin)).toThrow('metadata mismatch')
  }
  json(path.join(directory, 'payload.json'), payload)
  fs.appendFileSync(file, 'modified')
  expect(() => validateShellPayload(directory, pin)).toThrow('SHA256/path mismatch')
  expect(managedShell({ kind: 'bash', ...options })).toBeUndefined()
})

it('uses only isolated npm installs with scripts/manifest writes disabled and reports failures without receipts', () => {
  const options = fixture()
  options.env.npm_execpath = executable(path.join(options.directory, 'npm/bin/npm-cli.js'), '')
  vi.mocked(spawnSync).mockReturnValue({ status: 1 })
  const result = provisionShells(options)
  expect(result).toEqual({ failed: true, shells: [] })
  expect(spawnSync).toHaveBeenCalledTimes(2)
  for (const [file, args, spawnOptions] of spawnSync.mock.calls) {
    expect(file).toBe(process.execPath)
    expect(args[0]).toBe(options.env.npm_execpath)
    expect(args).toEqual(expect.arrayContaining(['install', '--global=false', '--workspaces=false', '--no-save', '--no-package-lock', '--ignore-scripts']))
    const prefix = args[args.indexOf('--prefix') + 1]
    expect(prefix.startsWith(shellStoreRoot(options))).toBe(true)
    expect(spawnOptions).toMatchObject({ cwd: prefix, stdio: 'inherit', windowsHide: true })
    expect(fs.existsSync(prefix)).toBe(false)
  }
  expect(options.warn).toHaveBeenCalledTimes(2)
  expect(options.warn.mock.calls.every(([message]) => message.includes(SHELL_PROVISION_COMMAND))).toBe(true)
  for (const kind of ['bash', 'pwsh'])
    expect(fs.existsSync(path.join(managedShellDirectory({ kind, ...options }), '.provisioned.json'))).toBe(false)
  expect(provisionShells({ ...options, env: { ...options.env, DSH_OPS_SHELLS: 'bash' } }).failed).toBe(true)
  expect(spawnSync).toHaveBeenCalledTimes(3)
})

it('does not publish corrupt npm payloads or destroy existing receipts when install validation fails', () => {
  const options = fixture()
  options.env.DSH_OPS_SHELLS = 'bash'
  options.env.npm_execpath = executable(path.join(options.directory, 'npm-cli.js'), '')
  const directory = managedShellDirectory({ kind: 'bash', ...options })
  fs.mkdirSync(directory, { recursive: true })
  const marker = path.join(directory, '.provisioned.json')
  fs.writeFileSync(marker, 'old invalid receipt retained for recovery')
  vi.mocked(spawnSync).mockImplementation((_file, args) => {
    packageFixture(path.join(args[args.indexOf('--prefix') + 1], 'node_modules', SHELL_UPSTREAM_PINS[0].payloadPackage), SHELL_UPSTREAM_PINS[0])
    return { status: 0 }
  })
  expect(provisionShells(options)).toEqual({ failed: true, shells: [] })
  expect(fs.readFileSync(marker, 'utf8')).toBe('old invalid receipt retained for recovery')
  expect(options.warn).toHaveBeenCalledWith(expect.stringContaining('SHA256/path mismatch'))
  expect(managedShell({ kind: 'bash', ...options })).toBeUndefined()
})

it('resolves bundled before allowed local/system and never throws when a platform runtime is absent', () => {
  const options = fixture()
  const bundleRoot = path.join(options.directory, 'dist')
  const provenance = path.join(bundleRoot, 'runtime/win32-x64/provenance.json')
  executable(provenance, '{}')
  const bundled = executable(bundledShellPath({ kind: 'bash', bundleRoot, ...options }))
  const wsl = path.join(options.directory, 'Windows/System32')
  const launcher = executable(path.join(wsl, 'bash.exe'))
  const wslEnv = { ...options.env, PATH: wsl, SystemRoot: path.dirname(wsl) }
  for (const allowSystemShellFallback of [false, true]) {
    expect(resolveShells({ bashPath: launcher, allowSystemShellFallback }, { ...options, bundleRoot, env: wslEnv }).bash).toMatchObject({
      available: false,
      file: undefined,
      source: 'config',
      detail: expect.stringContaining('WSL launcher'),
    })
  }
  options.env.PATH = path.join(options.directory, 'system')
  executable(path.join(options.env.PATH, 'bash.exe'))
  expect(resolveShells({ allowSystemShellFallback: true }, { ...options, bundleRoot }).bash).toMatchObject({ source: 'bundled', file: bundled })
  expect(resolveShells({ publishBashTool: false }, { ...options, bundleRoot }).bash).toMatchObject({ available: false, source: 'disabled' })
  fs.rmSync(bundled)
  expect(resolveShells({ allowSystemShellFallback: false }, { ...options, bundleRoot }).bash.available).toBe(false)
  expect(resolveShells({ allowSystemShellFallback: true }, { ...options, bundleRoot }).bash.available).toBe(false)
  expect(resolveShells({ allowSystemShellFallback: true }, { ...options, platform: 'linux', bundleRoot }).bash.available).toBe(false)
  expect(resolveShells({}, { ...options, bundleRoot: path.join(options.directory, 'absent') }).bash.detail).toContain(SHELL_PROVISION_COMMAND)
  expect(systemShell({ kind: 'bash', ...options, env: wslEnv })).toBeUndefined()
  expect(spawnSync).not.toHaveBeenCalled()
})

it('rejects broken/version-incompatible locals and only downloads the missing kind', () => {
  const options = fixture()
  const bin = path.join(options.directory, 'local/bin')
  const bash = executable(path.join(bin, 'bash.exe'))
  const pwsh = executable(path.join(bin, 'pwsh.exe'))
  const dll = executable(path.resolve(bin, '../usr/bin/msys-2.0.dll'), 'wrong ABI')
  options.env.PATH = bin
  options.env.npm_execpath = executable(path.join(options.directory, 'npm-cli.js'), '')
  vi.mocked(spawnSync).mockImplementation(file => file === bash
    ? { status: 0, stdout: 'GNU bash, version 5.2.37(1)-release\n' }
    : file === pwsh ? { status: 0, stdout: 'PowerShell 7.6.6\n' } : { status: 1 })
  expect(provisionShells(options)).toMatchObject({ failed: true, shells: [{ kind: 'pwsh', source: 'local', detectedVersion: '7.6.6' }] })
  expect(options.warn).toHaveBeenCalledWith(expect.stringContaining('Bash MSYS SHA256 mismatch'))
  const installs = spawnSync.mock.calls.filter(([file]) => file === process.execPath)
  expect(installs).toHaveLength(1)
  expect(installs[0][1]).toContain('@dshopslite/win32-x64-bash@2.56.0-windows.2')
  expect(fs.existsSync(dll)).toBe(true)
  for (const output of ['PowerShell 5.1.0', 'not PowerShell', '']) {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: output })
    expect(() => validateLocalShell({ ...options, kind: 'pwsh', file: pwsh })).toThrow('version unsupported')
  }
  vi.mocked(spawnSync).mockReturnValue({ status: 1 })
  expect(() => validateLocalShell({ ...options, kind: 'pwsh', file: pwsh })).toThrow('version probe failed')
  vi.mocked(spawnSync).mockReturnValue({ error: new Error('ETIMEDOUT') })
  expect(() => validateLocalShell({ ...options, kind: 'pwsh', file: pwsh })).toThrow('ETIMEDOUT')
})

it('force-managed bypasses compatible local discovery and leaves its receipt intact on npm failure', () => {
  const options = fixture()
  options.env.DSH_OPS_SHELLS = 'pwsh'
  options.env.PATH = path.join(options.directory, 'local')
  const pwsh = executable(path.join(options.env.PATH, 'pwsh.exe'))
  options.env.npm_execpath = executable(path.join(options.directory, 'npm-cli.js'), '')
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'PowerShell 7.6.6\n' })
  expect(provisionShells(options).failed).toBe(false)
  vi.mocked(spawnSync).mockReset().mockReturnValue({ status: 1 })
  expect(provisionShells({ ...options, env: { ...options.env, DSH_OPS_FORCE_MANAGED_SHELLS: '1' } })).toEqual({ failed: true, shells: [] })
  expect(spawnSync).toHaveBeenCalledTimes(1)
  expect(spawnSync.mock.calls[0][0]).toBe(process.execPath)
  expect(managedShell({ kind: 'pwsh', ...options, allowLocal: true })).toMatchObject({ source: 'local', file: pwsh })
})

it('executes the published script with no dist or dependencies and soft-fails only postinstall', async () => {
  const { spawnSync: actualSpawnSync } = await vi.importActual('node:child_process')
  const options = fixture()
  for (const relative of ['scripts/provision-shells.mjs', 'src/ops/provision.js', 'src/ops/shell-payloads.js']) {
    const destination = path.join(options.directory, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), destination)
  }
  json(path.join(options.directory, 'package.json'), { type: 'module' })
  const script = path.join(options.directory, 'scripts/provision-shells.mjs')
  const env = { ...process.env, DSH_HOME: options.env.DSH_HOME, DSH_OPS_SKIP_SHELL_PAYLOAD: '0', DSH_OPS_SHELLS: 'invalid' }
  expect(actualSpawnSync(process.execPath, [script, '--postinstall'], { env, stdio: 'ignore' }).status).toBe(0)
  expect(actualSpawnSync(process.execPath, [script], { env, stdio: 'ignore' }).status).toBe(1)
  expect(actualSpawnSync(process.execPath, [script], { env: { ...env, DSH_OPS_SKIP_SHELL_PAYLOAD: '1' }, stdio: 'ignore' }).status).toBe(0)
  expect(fs.existsSync(options.env.DSH_HOME)).toBe(false)
})
