import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { findCargo } from '../src/ops/rust.js'
import { shellUpstreamPin } from '../src/ops/shells.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = path.join(root, '.cache/runtime')
const dist = path.join(root, 'dist')
const triples = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'darwin-arm64': 'aarch64-apple-darwin',
}
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`${file} failed (${result.signal ?? result.status})`)
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    fs.renameSync(temporary, file)
  }
  finally {
    fs.rmSync(temporary, { force: true })
  }
}

async function shellTree(kind) {
  const pin = shellUpstreamPin({ kind })
  if (!pin)
    throw new Error(`No pinned ${kind} build for ${process.platform}-${process.arch}`)
  const directory = path.join(cache, 'shells', `${kind}-${pin.version}`)
  const executable = path.join(directory, pin.executableRelativePath)
  const receiptFile = path.join(directory, 'provenance.json')
  if (fs.existsSync(receiptFile) && fs.existsSync(executable)) {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
    if (receipt.sha256 === pin.sha256 && sha256(executable) === pin.executableSha256)
      return { directory, pin }
    throw new Error(`Pinned ${kind} cache changed; remove only ${directory} and rebuild`)
  }

  fs.mkdirSync(path.join(cache, 'downloads'), { recursive: true })
  const archive = path.join(cache, 'downloads', pin.assetFile)
  if (!fs.existsSync(archive)) {
    const temporary = `${archive}.${randomUUID()}.tmp`
    try {
      console.warn(`Downloading build input: ${pin.assetFile}`)
      const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
      const args = ['--location', '--fail', '--silent', '--show-error', '--connect-timeout', '30', '--max-time', '600', '--output', temporary]
      if (proxy?.trim())
        args.push('--proxy', proxy.trim())
      run('curl.exe', [...args, pin.url])
      if (fs.statSync(temporary).size !== pin.bytes || sha256(temporary) !== pin.sha256)
        throw new Error(`Pinned archive digest mismatch: ${pin.assetFile}`)
      fs.renameSync(temporary, archive)
    }
    finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  if (fs.statSync(archive).size !== pin.bytes || sha256(archive) !== pin.sha256)
    throw new Error(`Pinned archive digest mismatch: ${archive}`)

  fs.mkdirSync(path.dirname(directory), { recursive: true })
  const staging = fs.mkdtempSync(path.join(path.dirname(directory), `${kind}-`))
  try {
    const output = path.join(staging, pin.extractTo)
    fs.mkdirSync(output, { recursive: true })
    if (pin.extractor === 'sfx-7z')
      run(archive, ['-y', `-o${output}`])
    else if (pin.extractor === 'zip')
      run(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe'), ['-xf', archive, '-C', output])
    else
      throw new Error(`Unsupported shell extractor: ${pin.extractor}`)
    if (sha256(path.join(staging, pin.executableRelativePath)) !== pin.executableSha256)
      throw new Error(`Pinned executable digest mismatch: ${kind}`)
    writeJson(path.join(staging, 'provenance.json'), pin)
    fs.renameSync(staging, directory)
  }
  finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return { directory, pin }
}

/** Build this machine's complete runtime in CI/development, never during npm installation or plugin loading. */
export async function buildRuntime() {
  const target = `${process.platform}-${process.arch}`
  const triple = triples[target]
  if (!triple)
    throw new Error(`Unsupported runtime build target: ${target}`)
  const cargo = findCargo()
  const runtime = path.join(dist, 'runtime', target)
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  fs.mkdirSync(runtime, { recursive: true })

  for (const [source, name, receiptName, binaryVersion] of [
    ['native', 'dsh-ops-worker', 'provenance.json', version],
    ['vendor/fastctx', 'fastctx', 'fastctx.provenance.json', '0.2.6'],
  ]) {
    const targetDir = path.join(cache, name === 'fastctx' ? 'fastctx-target' : 'worker-target')
    run(cargo.file, ['build', '--release', '--locked', '--manifest-path', path.join(root, source, 'Cargo.toml'), '--bin', name, '--target', triple, '--target-dir', targetDir], cargo.env)
    const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`
    const built = path.join(targetDir, triple, 'release', executable)
    const destination = path.join(runtime, executable)
    if (!fs.existsSync(destination) || sha256(built) !== sha256(destination))
      fs.copyFileSync(built, destination)
    if (process.platform !== 'win32')
      fs.chmodSync(destination, 0o755)
    writeJson(path.join(runtime, receiptName), { version: binaryVersion, target, executable, sha256: sha256(destination), source: `${source}/Cargo.lock + ${source}/src` })
  }

  const licenses = path.join(dist, 'licenses')
  fs.mkdirSync(licenses, { recursive: true })
  for (const name of ['LICENSE', 'NOTICE'])
    fs.copyFileSync(path.join(root, 'native', name), path.join(licenses, `dsh-ops-${name}`))
  const fastctx = path.join(root, 'vendor/fastctx')
  for (const name of fs.readdirSync(fastctx).filter(name => /^(?:LICENSE|NOTICE|THIRD_PARTY)/.test(name)))
    fs.cpSync(path.join(fastctx, name), path.join(licenses, 'fastctx', name), { recursive: true })
  fs.cpSync(path.join(fastctx, 'third-party'), path.join(licenses, 'fastctx/third-party'), { recursive: true })
  fs.copyFileSync(path.join(root, 'bin/prepare-workspace.ps1'), path.join(dist, 'prepare-workspace.ps1'))

  if (process.platform === 'win32') {
    const bash = await shellTree('bash')
    const pwsh = await shellTree('pwsh')
    fs.cpSync(bash.directory, path.join(dist, 'vendor/bash', target), { recursive: true })
    fs.cpSync(path.join(pwsh.directory, pwsh.pin.extractTo), path.join(dist, 'vendor/pwsh', target), { recursive: true })
    fs.copyFileSync(path.join(pwsh.directory, 'provenance.json'), path.join(dist, 'vendor/pwsh', target, 'provenance.json'))
    run(process.execPath, [path.join(root, 'bin/build-bash-ipc.mjs'), '--source', path.join(bash.directory, 'usr/bin/msys-2.0.dll'), '--output', path.join(cache, 'bash-ipc')])
    fs.cpSync(path.join(cache, 'bash-ipc'), path.join(runtime, 'bash-ipc'), { recursive: true })
  }
  console.warn(`Built complete ${target} runtime from root-owned sources.`)
}
