import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { buildBashIpc } from './build-bash-ipc.mjs'
import { buildNative, stageNative } from './build-native.mjs'
import { NATIVE_TARGETS, prepareUpstream, PROJECT_ROOT, replaceOnce } from './prepare-upstream.mjs'

// One isolated regression exercises staging, runtime selection, and provenance.
it('stages the upstream contract without modifying source or bundling payloads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-stage-'))
  try {
    const source = path.join(root, 'source/dsh-ops')
    fs.mkdirSync(source, { recursive: true })
    for (const file of ['lib', 'bin', 'package.json', 'LICENSE', 'NOTICE', 'native', 'vendor/fastctx']) {
      const destination = path.join(source, file)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.cpSync(path.join(PROJECT_ROOT, 'source/dsh-ops', file), destination, {
        recursive: true,
        filter: file => !['target', 'node_modules', '.git'].includes(path.basename(file)),
      })
    }
    const sourceFile = path.join(source, 'lib/index.js')
    const original = fs.readFileSync(sourceFile)
    const upstream = prepareUpstream(root)
    const first = fs.readFileSync(path.join(upstream, 'lib/index.js'))
    fs.mkdirSync(path.join(upstream, 'runtime'), { recursive: true })
    fs.writeFileSync(path.join(upstream, 'runtime/keep'), 'owned worker')
    prepareUpstream(root)
    expect(fs.readFileSync(path.join(upstream, 'runtime/keep'), 'utf8')).toBe('owned worker')
    expect(fs.readFileSync(path.join(upstream, 'lib/index.js'))).toEqual(first)
    expect(fs.readFileSync(sourceFile)).toEqual(original)
    expect(first.toString()).not.toContain('mountConfigUpdates')
    expect(() => replaceOnce('changed', 'missing', '', 'upstream.js')).toThrow('exactly once')
    expect(() => replaceOnce('same same', 'same', '', 'upstream.js')).toThrow('exactly once')
    for (const target of ['freebsd-x64', 'constructor', 'toString', '__proto__'])
      expect(() => buildNative({ root, target })).toThrow('Unsupported native build target')
    for (const file of ['LICENSE', 'NOTICE', 'vendor/fastctx/LICENSE-APACHE', 'vendor/fastctx/NOTICE', 'vendor/fastctx/UPSTREAM.md', 'vendor/fastctx/FORK.md', 'vendor/fastctx/THIRD_PARTY_LICENSES.md', 'vendor/fastctx/THIRD_PARTY_LICENSES_RUST.md'])
      expect(fs.readFileSync(path.join(upstream, file))).toEqual(fs.readFileSync(path.join(source, file)))
    expect(fs.existsSync(path.join(upstream, 'vendor/fastctx/src/main.rs'))).toBe(true)
    expect(fs.existsSync(path.join(upstream, 'vendor/fastctx/target'))).toBe(false)
    expect(fs.existsSync(path.join(upstream, 'bin/prepare-workspace.ps1'))).toBe(true)
    expect(fs.existsSync(path.join(upstream, 'native/bash-ipc/security.h'))).toBe(true)
    expect(fs.readFileSync(path.join(upstream, 'bin/build-bash-ipc.mjs'), 'utf8')).toContain('process.env.DSH_OPS_MSYS_DLL ??')
    expect(() => buildBashIpc()).toThrow('--bash-root must be an absolute')
    expect(() => buildBashIpc({ bashRoot: 'relative' })).toThrow('--bash-root must be an absolute')
    const invalidBash = path.join(root, 'invalid-bash')
    fs.mkdirSync(path.join(invalidBash, 'usr/bin'), { recursive: true })
    fs.writeFileSync(path.join(invalidBash, 'usr/bin/bash.exe'), 'fixture')
    fs.writeFileSync(path.join(invalidBash, 'usr/bin/msys-2.0.dll'), 'not a PE')
    expect(() => buildBashIpc({ bashRoot: invalidBash, root })).toThrow('Expected PE')
    const manifest = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'))
    expect(manifest.version).toBe('0.3.0')
    expect(manifest.name).toBe('dsh-ops')
    for (const field of ['optionalDependencies', 'os', 'cpu', 'scripts'])
      expect(manifest).not.toHaveProperty(field)
    const rootManifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
    for (const field of ['dependencies', 'optionalDependencies'])
      expect(Object.keys(rootManifest[field] ?? {}).some(name => /^@(?:dsh-ops|fastctx)\//.test(name))).toBe(false)
    const shells = await import(pathToFileURL(path.join(upstream, 'lib/shells.js')).href)
    for (const name of ['fromPath', 'isWslBashLauncher', 'wellKnownCandidates', 'executableNames'])
      expect(typeof shells[name]).toBe('function')
    const { applyComponent } = await import(pathToFileURL(path.join(upstream, 'lib/index.js')).href)
    let selected = false
    const resolution = {
      get pwsh() {
        selected = true
        return { available: false }
      },
    }
    applyComponent({ inject() {} }, { configUpdateVersion: 1, promptPolicy: false }, 'shell', { shells: resolution })
    expect(selected).toBe(true)

    // Exercise the registered tool and host disposer, not a mocked surface.stop.
    const worker = path.join(root, 'worker')
    fs.writeFileSync(worker, 'fixture')
    const subprocessDone = Promise.withResolvers()
    let registered = 0
    let inspect
    let disposeFile
    let mount
    let signal
    const context = {
      logger: { info() {} },
      effect(create) { disposeFile = create() },
      inject(_services, callback) { mount = callback(context) },
      tools: {
        register(tool) {
          registered++
          if (tool.name === 'ops_inspect_local_file')
            inspect = tool.execute
          return () => registered--
        },
      },
      get(service) {
        if (service === 'sandboxPolicy')
          return { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: root }) }
        if (service === 'subprocess') {
          return {
            spawn(request) {
              signal = request.signal
              return {
                done: subprocessDone.promise,
                collected: { stdout: { readFrom: () => ({ text: '{}', lossy: false }) }, stderr: { readFrom: () => ({ text: '' }) } },
              }
            },
          }
        }
      },
    }
    applyComponent(context, { binaryPath: worker, configUpdateVersion: 1, promptPolicy: false }, 'file')
    await mount
    const exec = { agent: { session: { id: 'lifecycle', header: { cwd: root } } } }
    const invocation = inspect({ path: '.' }, exec)
    const stopping = disposeFile()
    expect(stopping).toBeInstanceOf(Promise)
    expect(signal.aborted).toBe(true)
    let stopped = false
    void stopping.then(() => {
      stopped = true
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(stopped).toBe(false)
    expect(registered).toBe(4)
    expect((await inspect({ path: '.' }, exec)).error.code).toBe('POLICY_DENIED')
    subprocessDone.resolve({ exitCode: 0 })
    expect((await invocation).error.code).toBe('RESULT_UNKNOWN')
    await stopping
    expect(registered).toBe(0)

    const { PLATFORMS, resolveWorker, workerName } = await import(pathToFileURL(path.join(upstream, 'lib/ptc/runtime.js')).href)
    const { createHash } = await import('node:crypto')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }))
    expect(PLATFORMS).toEqual(Object.keys(NATIVE_TARGETS))
    for (const target of PLATFORMS) {
      const [platform, arch] = target.split('-')
      const directory = path.join(root, 'runtime', target)
      const file = path.join(directory, workerName(platform))
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(file, `fixture-${target}`)
      const receipt = { version: '0.3.0', target, executable: workerName(platform), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
      fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(receipt))
      expect(resolveWorker({ binaryPath: file }, { packageRoot: root, platform, arch })).toBe(file)
      fs.appendFileSync(file, 'tampered')
      expect(() => resolveWorker({ binaryPath: file }, { packageRoot: root, platform, arch })).toThrow('provenance mismatch')
    }
    expect(() => resolveWorker({}, { packageRoot: root, platform: 'freebsd', arch: 'x64' })).toThrow('Unsupported native runtime target')
    const native = stageNative(root)
    const patched = path.join(native, 'src/file.rs')
    const timestamp = fs.statSync(patched).mtimeMs
    stageNative(root)
    expect(fs.statSync(patched).mtimeMs).toBe(timestamp)
    expect(fs.readFileSync(patched, 'utf8')).toContain('file.set_permissions(permissions)?;')
    expect(fs.readFileSync(patched, 'utf8')).toContain('if cfg!(windows) { display.replace')
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
