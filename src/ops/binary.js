/** Resolve explicit selections or the exact OS/CPU runtime supplied by npm. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import manifest from '../../package.json' with { type: 'json' }

/** Bundled host modules and development runtime assets live directly in dist. */
export const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
export const BINARY_ENV = 'DSH_OPS_FASTCTX_BIN'

export function runtimeRoot({ packageRoot = PACKAGE_ROOT, platform = process.platform, arch = process.arch } = {}) {
  const target = `${platform}-${arch}`
  const name = `dsh-ops-lite-${target}`
  if (!Object.hasOwn(manifest.optionalDependencies, name))
    throw new Error(`Unsupported dsh-ops-lite runtime target ${target}. No download or compilation fallback is used.`)
  if (fs.existsSync(path.join(packageRoot, 'runtime', target, 'provenance.json')))
    return packageRoot
  let file
  try {
    file = createRequire(path.join(packageRoot, 'package.json')).resolve(`${name}/package.json`)
  }
  catch (error) {
    throw new Error(`Runtime package ${name}@${manifest.version} is unavailable. Install dsh-ops-lite with optional dependencies enabled for a supported OS/CPU. No download or compilation fallback is used.`, { cause: error })
  }
  const installed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (installed.name !== name || installed.version !== manifest.version
    || !Array.isArray(installed.os) || !installed.os.includes(platform)
    || !Array.isArray(installed.cpu) || !installed.cpu.includes(arch)) {
    throw new Error(`Runtime package metadata mismatch: ${name}@${manifest.version}`)
  }
  return path.dirname(file)
}

export class BinaryNotFoundError extends Error {
  constructor(message, tried) {
    super(message)
    this.name = 'BinaryNotFoundError'
    this.tried = tried
  }

  report() {
    return this.tried.map(candidate => `  - ${candidate.source}: ${candidate.file} (${candidate.detail})`).join('\n')
  }
}

export function executableName(platform = process.platform) {
  return platform === 'win32' ? 'fastctx.exe' : 'fastctx'
}

function describeFile(file) {
  try {
    return fs.statSync(file).isFile() ? 'exists' : 'not a regular file'
  }
  catch (error) {
    return error.code === 'ENOENT' ? 'missing' : String(error.message ?? error)
  }
}

/** Explicit choices are authoritative; missing platform packages never use ambient binaries. */
export function resolveBinary({ binaryPath, packageRoot = PACKAGE_ROOT, env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const tried = []
  for (const [selected, source] of [[binaryPath, 'config.binaryPath'], [env[BINARY_ENV], BINARY_ENV]]) {
    if (selected === undefined || (source === BINARY_ENV && selected.trim() === ''))
      continue
    const file = source === BINARY_ENV ? path.resolve(selected) : selected
    const detail = describeFile(file)
    tried.push({ file, source, detail })
    if (detail !== 'exists')
      throw new BinaryNotFoundError(`${source} does not name an existing file: ${file}`, tried)
    return { file, source, tried }
  }
  const file = path.join(runtimeRoot({ packageRoot, platform, arch }), 'runtime', `${platform}-${arch}`, executableName(platform))
  const detail = describeFile(file)
  tried.push({ file, source: 'bundled runtime', detail })
  if (detail !== 'exists')
    throw new BinaryNotFoundError(`FastCtx is missing from the ${platform}-${arch} runtime package. Reinstall with optional dependencies enabled.`, tried)
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'fastctx.provenance.json'), 'utf8'))
  if (receipt.target !== `${platform}-${arch}` || receipt.version !== '0.2.6' || receipt.executable !== executableName(platform)
    || receipt.sha256 !== createHash('sha256').update(fs.readFileSync(file)).digest('hex')) {
    throw new Error('FastCtx provenance mismatch.')
  }
  return { file, source: 'bundled runtime', tried }
}

export function probeBinary(file, { timeoutMs = 15_000, env = process.env } = {}) {
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env })
  if (result.error !== undefined && result.error !== null)
    return { ok: false, detail: String(result.error.message ?? result.error) }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim().split('\n')[0] ?? ''
    return { ok: false, detail: `exited ${result.status}${stderr === '' ? '' : `: ${stderr}`}` }
  }
  return { ok: true, version: (result.stdout ?? '').trim().split('\n')[0] ?? '' }
}
