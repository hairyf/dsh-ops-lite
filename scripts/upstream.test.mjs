import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import { resolveBinary } from '../src/ops/binary.js'
import { McpStdioClient } from '../src/ops/handshake.js'
import { applyComponent } from '../src/ops/index.js'
import { PLATFORMS, resolveWorker, workerName } from '../src/ops/ptc/runtime.js'

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

it('settles MCP replies and cancellation once without losing the client context', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const client = new McpStdioClient(child, 1000)
  try {
    const reply = client.request('tools/list')
    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":')
    child.stdout.write('{"tools":[]}}\n')
    expect(await reply).toEqual({ tools: [] })
    expect(client.pending.size).toBe(0)
    const controller = new AbortController()
    const request = client.request('tools/call', {}, { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toThrow('was canceled')
    expect(client.pending.size).toBe(0)
  }
  finally {
    child.emit('exit', 0, null)
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
})

it('keeps native and FastCtx provenance fail-closed on every supported target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-contract-'))
  try {
    for (const target of PLATFORMS) {
      const [platform, arch] = target.split('-')
      const directory = path.join(root, 'runtime', target)
      fs.mkdirSync(directory, { recursive: true })
      const file = path.join(directory, workerName(platform))
      fs.writeFileSync(file, `fixture-${target}`)
      const receipt = { version: manifest.version, target, executable: workerName(platform), sha256: digest(file) }
      fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(receipt))
      expect(resolveWorker({}, { packageRoot: root, env: {}, platform, arch })).toBe(file)
      fs.appendFileSync(file, 'tampered')
      expect(() => resolveWorker({}, { packageRoot: root, env: {}, platform, arch })).toThrow('provenance mismatch')
      const fastctx = path.join(directory, platform === 'win32' ? 'fastctx.exe' : 'fastctx')
      fs.writeFileSync(fastctx, `fastctx-${target}`)
      const fastctxReceipt = { version: '0.2.6', target, executable: path.basename(fastctx), sha256: digest(fastctx) }
      fs.writeFileSync(path.join(directory, 'fastctx.provenance.json'), JSON.stringify(fastctxReceipt))
      expect(resolveBinary({ packageRoot: root, env: {}, platform, arch })).toMatchObject({ file: fastctx, source: 'bundled runtime' })
      fs.appendFileSync(fastctx, 'tampered')
      expect(() => resolveBinary({ packageRoot: root, env: {}, platform, arch })).toThrow('provenance mismatch')
    }
    expect(() => resolveWorker({}, { packageRoot: root, platform: 'freebsd', arch: 'x64' })).toThrow('Unsupported')
    expect(() => resolveWorker({ binaryPath: 'relative' })).toThrow('absolute path')
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('unloading the actual registered file tools aborts and drains in-flight work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-lifecycle-'))
  try {
    const worker = path.join(root, 'worker')
    fs.writeFileSync(worker, 'fixture')
    let complete
    const done = new Promise((resolve) => {
      complete = resolve
    })
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
              return { done, collected: { stdout: { readFrom: () => ({ text: '{}', lossy: false }) }, stderr: { readFrom: () => ({ text: '' }) } } }
            },
          }
        }
      },
    }
    applyComponent(context, { binaryPath: worker, required: true, promptPolicy: false }, 'file')
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
    complete({ exitCode: 0 })
    expect((await invocation).error.code).toBe('RESULT_UNKNOWN')
    await stopping
    expect(registered).toBe(0)
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
