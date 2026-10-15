import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveBinary } from '../src/ops/binary.js'
import { resolveWorker } from '../src/ops/ptc/runtime.js'
import { bundledShellPath, shellUpstreamPin } from '../src/ops/shells.js'

const root = path.resolve(import.meta.dirname, '..')
const target = `${process.platform}-${process.arch}`
const directory = path.join(root, 'packages', target)
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (manifest.name !== `@dshopslite/${target}` || manifest.version !== main.version
  || !manifest.os.includes(process.platform) || !manifest.cpu.includes(process.arch)) {
  throw new Error(`Platform package does not match the current build: ${target}`)
}
const dist = path.join(root, 'dist')
resolveWorker({}, { packageRoot: dist, env: {} })
resolveBinary({ packageRoot: dist, env: {} })
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
if (process.platform === 'win32') {
  for (const kind of ['bash', 'pwsh']) {
    const file = bundledShellPath({ kind, bundleRoot: dist, platform: process.platform, arch: process.arch })
    if (digest(file) !== shellUpstreamPin({ kind }).executableSha256)
      throw new Error(`Pinned ${kind} executable mismatch`)
  }
  const proxies = path.join(dist, 'runtime', target, 'bash-ipc')
  const receipt = JSON.parse(fs.readFileSync(path.join(proxies, 'provenance.json'), 'utf8'))
  if (receipt.platform !== target || receipt.msysSha256 !== digest(path.join(dist, 'vendor/bash', target, 'usr/bin/msys-2.0.dll')))
    throw new Error('Bash IPC MSYS provenance mismatch')
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
  if (name === 'vendor' && process.platform !== 'win32')
    continue
  fs.mkdirSync(output, { recursive: true })
  if (name === 'runtime') {
    fs.cpSync(path.join(dist, name, target), path.join(output, target), { recursive: true })
  }
  else if (name === 'vendor') {
    for (const kind of ['bash', 'pwsh'])
      fs.cpSync(path.join(dist, name, kind, target), path.join(output, kind, target), { recursive: true })
  }
  else {
    fs.cpSync(path.join(dist, name), output, { recursive: true })
  }
}
console.warn(`Prepared ${manifest.name}@${manifest.version} for npm packaging.`)
