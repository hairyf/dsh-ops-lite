import type { RuntimeResolution, RuntimeSet } from '../src/types'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

const project = fileURLToPath(new URL('../', import.meta.url))
const cli = path.join(project, 'dist/cli.js')
const bash = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
  : '/bin/bash'
let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-next-runtimes-'))
})
afterEach(() => {
  assert.equal(path.dirname(home), path.resolve(os.tmpdir()))
  assert(path.basename(home).startsWith('dsh-ops-next-runtimes-'))
  fs.rmSync(home, { recursive: true, force: true })
})

function run(args: string[], searchPath = '') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/i.test(key) && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && key.toUpperCase() !== 'PATH'))
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: home,
    env: { ...env, DSH_HOME: home, HOME: home, USERPROFILE: home, PATH: searchPath },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  if (result.error)
    throw result.error
  return result
}

function doctor(args: string[] = [], searchPath = ''): RuntimeSet & { worker: RuntimeResolution } {
  const result = run(['doctor', ...args], searchPath)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

it('an explicit local path without consent is neither probed nor silently provisioned', () => {
  const result = doctor(['--bash-path', bash])
  expect(result.bash).toMatchObject({ available: false, source: 'local:config' })
  expect(result.bash.tried).toEqual([{ file: bash, source: 'local', detail: expect.stringContaining('not been authorized') }])
  const provision = run(['provision', '--bash', '--bash-path', bash])
  expect(provision.status).toBe(1)
  expect(provision.stderr).toContain('requires authorization')
  expect(provision.stdout).not.toContain('provisioning')
  expect(fs.readdirSync(home)).toEqual([])
})

it('authorized absolute Bash is reused without downloads or PATH changes', () => {
  expect(fs.existsSync(bash), 'The platform CI runner must supply Bash').toBe(true)
  const originalPath = process.env.PATH
  const result = doctor(['--allow-local', '--bash-path', bash])
  expect(result.bash).toMatchObject({ available: true, source: 'local:config', file: path.resolve(bash) })
  expect(result.bash.version).toMatch(/^\d/)
  const provision = run(['provision', '--bash', '--allow-local', '--bash-path', bash])
  expect(provision.status, provision.stderr).toBe(0)
  expect(provision.stdout).toContain('reusing local:config')
  const force = run(['provision', '--bash', '--allow-local', '--bash-path', bash, '--force', '--dry-run'])
  expect(force.status, force.stderr).toBe(0)
  expect(force.stdout).toContain('would run the pinned upstream provision-shells --bash --force')
  expect(force.stdout).not.toContain('reusing')
  expect(process.env.PATH).toBe(originalPath)
  expect(fs.readdirSync(home)).toEqual([])
})

it('an incompatible authoritative path fails instead of falling back or installing', () => {
  const missing = path.join(home, 'missing-bash')
  const result = doctor(['--allow-local', '--bash-path', missing], path.dirname(bash))
  expect(result.bash).toMatchObject({ available: false, source: 'local:config' })
  expect(result.bash.tried.map(attempt => attempt.source)).toEqual(['local:config'])
  const provision = run(['provision', '--bash', '--allow-local', '--bash-path', missing, '--dry-run'])
  expect(provision.status).toBe(1)
  expect(provision.stderr).toContain('authoritative but incompatible')
  expect(provision.stdout).not.toContain('would run')
  expect(fs.readdirSync(home)).toEqual([])
})

it('managed mode excludes both explicit local selection and PATH discovery', () => {
  const result = doctor(['--managed', '--allow-local', '--bash-path', bash], path.dirname(bash))
  expect(result.bash.available).toBe(false)
  expect(result.bash.tried[0]).toMatchObject({ file: bash, source: 'local', detail: expect.stringContaining('excludes local') })
  expect(result.bash.tried.some(attempt => attempt.source.startsWith('local:'))).toBe(false)
  const provision = run(['provision', '--bash', '--managed', '--bash-path', bash, '--dry-run'])
  expect(provision.status, provision.stderr).toBe(0)
  expect(provision.stdout).toContain('would run the pinned upstream provision-shells --bash')
  expect(fs.readdirSync(home)).toEqual([])
})

it('a rejected first PATH executable does not hide a later compatible Bash', () => {
  const first = path.join(home, 'first-path')
  fs.mkdirSync(first)
  const incompatible = path.join(first, process.platform === 'win32' ? 'bash.exe' : 'bash')
  fs.writeFileSync(incompatible, '#!/missing-runtime\n', { mode: 0o755 })
  const result = doctor(['--allow-local'], [first, path.dirname(bash)].join(path.delimiter))
  expect(result.bash).toMatchObject({ available: true, source: 'local:PATH', file: path.resolve(bash) })
  expect(result.bash.tried[0]).toMatchObject({ file: incompatible, source: 'local:PATH' })
  expect(result.bash.tried[0]!.detail).not.toContain('passed version')
})

it('managed FastCtx rejects forged provenance and a changed digest before executing', () => {
  const store = path.join(home, 'dsh-ops')
  const bin = path.join(store, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const file = path.join(bin, process.platform === 'win32' ? 'fastctx.exe' : 'fastctx')
  fs.writeFileSync(file, '#!/missing-runtime\n', { mode: 0o755 })
  const cargo = fs.readFileSync(path.join(project, 'dist/upstream/vendor/fastctx/Cargo.toml'), 'utf8')
  const version = /^version\s*=\s*"([\d.]+)"/m.exec(cargo)?.[1]
  assert(version, 'The pinned FastCtx source must declare a version')
  const receipt = {
    schemaVersion: 1,
    executable: file,
    executableName: path.basename(file),
    origin: 'untrusted source',
    version: `fastctx ${version}`,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }
  const receiptFile = path.join(store, 'runtime.json')
  fs.writeFileSync(receiptFile, JSON.stringify(receipt))
  const forged = doctor(['--managed']).fastctx
  expect(forged.available).toBe(false)
  expect(forged.tried.at(-1)?.detail).toContain('provenance mismatch; refusing execution')
  fs.writeFileSync(receiptFile, JSON.stringify({ ...receipt, origin: 'vendored source build' }))
  fs.appendFileSync(file, 'tampered\n')
  const tampered = doctor(['--managed']).fastctx
  expect(tampered.available).toBe(false)
  expect(tampered.tried.at(-1)?.detail).toContain('provenance mismatch; refusing execution')
  expect(fs.readdirSync(store).sort()).toEqual(['bin', 'runtime.json'])
})

it('provision requires an explicit selection and rejects non-absolute executable paths', () => {
  const empty = run(['provision', '--dry-run'])
  expect(empty.status).toBe(1)
  expect(empty.stderr).toContain('Select at least one runtime')
  const relative = run(['doctor', '--allow-local', '--bash-path', './bash'])
  expect(relative.status).toBe(1)
  expect(relative.stderr).toContain('must be absolute paths')
  expect(fs.readdirSync(home)).toEqual([])
})

it.skipIf(process.platform !== 'win32')('windows PowerShell 5.1 and the WSL Bash launcher are rejected', () => {
  const system32 = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32')
  const result = doctor(['--allow-local', '--pwsh-path', path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe'), '--bash-path', path.join(system32, 'bash.exe')])
  expect(result.pwsh).toMatchObject({ available: false, source: 'local:config' })
  expect(result.pwsh.tried[0]?.detail).toContain('Incompatible pwsh identity or version')
  expect(result.bash).toMatchObject({ available: false, source: 'local:config' })
  expect(result.bash.tried[0]?.detail).toContain('WSL bash.exe launcher')
})
