import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadBumpConfig, versionBump } from 'bumpp'
import { expect, it } from 'vitest'
import { syncNativeVersion } from '../bump.config.ts'
import manifest from '../package.json' with { type: 'json' }
import { executableName, resolveBinary, runtimeRoot } from '../src/ops/binary.js'
import { resolveWorker, workerName } from '../src/ops/ptc/runtime.js'
import { bundledShellPath } from '../src/ops/shells.js'

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value))

it('loads the release configuration and bumps every package and native crate together without release side effects', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const config = await loadBumpConfig(undefined, root)
  const packageFiles = ['package.json', ...['win32-x64', 'linux-x64', 'darwin-arm64'].map(target => `packages/${target}/package.json`)]
  const files = [...packageFiles, 'native/Cargo.toml', 'native/Cargo.lock']
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

it('marks every Unix runtime executable for npm consumers', () => {
  // `pnpm pack` writes 0644 unless the manifest lists the file here, and Unix
  // consumers execute these directly; `test/e2e/run.mjs` asserts the packed mode.
  for (const target of ['linux-x64', 'darwin-arm64']) {
    const [platform] = target.split('-')
    const file = fileURLToPath(new URL(`../packages/${target}/package.json`, import.meta.url))
    const publishConfig = JSON.parse(fs.readFileSync(file, 'utf8')).publishConfig
    expect(publishConfig.executableFiles).toEqual([
      `./runtime/${target}/${workerName(platform)}`,
      `./runtime/${target}/${executableName(platform)}`,
    ])
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
      const name = `dsh-ops-lite-${target}`
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
