import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveBinary } from '../src/ops/binary.js'
import { resolveWorker } from '../src/ops/ptc/runtime.js'
import { payloadExecutable, shellUpstreamPin } from '../src/ops/shell-payloads.js'

export function prepareRuntimePackages({ root = path.resolve(import.meta.dirname, '..'), platform = process.platform, arch = process.arch } = {}) {
  const target = `${platform}-${arch}`
  const directory = path.join(root, 'packages', target)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.name !== `@dshopslite/${target}` || manifest.version !== main.version
    || !manifest.os.includes(platform) || !manifest.cpu.includes(arch)) {
    throw new Error(`Platform package does not match the current build: ${target}`)
  }
  const dist = path.join(root, 'dist')
  resolveWorker({}, { packageRoot: dist, env: {}, platform, arch })
  resolveBinary({ packageRoot: dist, env: {}, platform, arch })
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const payloads = []
  if (platform === 'win32') {
    for (const kind of ['bash', 'pwsh']) {
      const pin = shellUpstreamPin({ kind, platform, arch })
      const output = path.join(root, 'packages', `${target}-${kind}`)
      const metadata = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'))
      if (metadata.name !== pin.payloadPackage || metadata.version !== pin.payloadVersion
        || !metadata.os.includes(platform) || !metadata.cpu.includes(arch)) {
        throw new Error(`Shell payload package does not match the pin: ${kind}`)
      }
      const executable = payloadExecutable(pin)
      if (digest(path.join(dist, executable)) !== pin.executableSha256)
        throw new Error(`Pinned ${kind} executable mismatch`)
      payloads.push({ output, pin, executable })
    }
    const proxies = path.join(dist, 'runtime', target, 'bash-ipc')
    const receipt = JSON.parse(fs.readFileSync(path.join(proxies, 'provenance.json'), 'utf8'))
    const msysSha256 = digest(path.join(dist, 'vendor/bash', target, 'usr/bin/msys-2.0.dll'))
    if (receipt.platform !== target || receipt.msysSha256 !== msysSha256
      || msysSha256 !== shellUpstreamPin({ kind: 'bash', platform, arch }).msysSha256) {
      throw new Error('Bash IPC MSYS provenance mismatch')
    }
    for (const name of ['opsipc.dll', 'opsnt.dll']) {
      if (receipt.files[name] !== digest(path.join(proxies, name)))
        throw new Error(`Bash IPC provenance mismatch: ${name}`)
    }
  }
  for (const name of ['runtime', 'vendor', 'licenses']) {
    // These are build-owned directories under the checked current-platform package.
    const output = path.resolve(directory, name)
    if (path.dirname(output) !== directory)
      throw new Error(`Invalid platform output: ${output}`)
    fs.rmSync(output, { recursive: true, force: true })
    if (name === 'vendor')
      continue
    fs.mkdirSync(output, { recursive: true })
    if (name === 'runtime')
      fs.cpSync(path.join(dist, name, target), path.join(output, target), { recursive: true })
    else
      fs.cpSync(path.join(dist, name), output, { recursive: true })
  }
  for (const { output, pin, executable } of payloads) {
    // The package directory and pin metadata were validated before replacing build outputs.
    for (const name of ['vendor', 'licenses']) {
      fs.rmSync(path.join(output, name), { recursive: true, force: true })
      const relative = name === 'vendor' ? `vendor/${pin.name}/${target}` : name
      fs.cpSync(path.join(dist, relative), path.join(output, relative), { recursive: true })
    }
    fs.writeFileSync(path.join(output, 'payload.json'), `${JSON.stringify({
      kind: pin.name,
      target,
      version: pin.payloadVersion,
      executable,
      sha256: pin.executableSha256,
    }, null, 2)}\n`)
    console.warn(`Prepared ${pin.payloadPackage}@${pin.payloadVersion} for npm packaging.`)
  }
  console.warn(`Prepared ${manifest.name}@${manifest.version} for npm packaging.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareRuntimePackages()
