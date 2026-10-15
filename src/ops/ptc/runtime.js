/** Runtime discovery is installation-relative; explicit selections never silently fall back. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import manifest from '../../../package.json' with { type: 'json' }
import { PACKAGE_ROOT, runtimeRoot } from '../binary.js'

export { PACKAGE_ROOT }
export const PLATFORMS = Object.freeze(Object.keys(manifest.optionalDependencies).map(name => name.slice('dsh-ops-lite-'.length)))
export function workerName(platform = process.platform) {
  return platform === 'win32' ? 'dsh-ops-worker.exe' : 'dsh-ops-worker'
}
export function resolveWorker(config = {}, { packageRoot = PACKAGE_ROOT, env = process.env, platform = process.platform, arch = process.arch } = {}) {
  if (!PLATFORMS.includes(`${platform}-${arch}`))
    throw new Error(`Unsupported dsh-ops-lite runtime target ${platform}-${arch}.`)
  const explicit = config.binaryPath ?? env.DSH_OPS_WORKER_BIN
  const candidates = explicit !== undefined
    ? [explicit]
    : [
        path.join(runtimeRoot({ packageRoot, platform, arch }), 'runtime', `${platform}-${arch}`, workerName(platform)),
      ]
  for (const file of candidates) {
    if (!path.isAbsolute(file))
      throw new Error('Native worker selection must be an absolute path.')
    let stat
    try {
      stat = fs.statSync(file)
    }
    catch { continue }
    if (!stat.isFile())
      continue
    if (file.includes(`${path.sep}runtime${path.sep}`)) {
      const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'provenance.json'), 'utf8'))
      const version = manifest.version
      if (receipt.target !== `${platform}-${arch}` || receipt.version !== version || receipt.executable !== workerName(platform)
        || receipt.sha256 !== createHash('sha256').update(fs.readFileSync(file)).digest('hex')) {
        throw new Error('Native worker provenance mismatch.')
      }
    }
    return file
  }
  throw new Error(`Native worker unavailable for ${platform}-${arch}. Install the matching platform artifact, or run pnpm build in the source checkout. No ACL repair, shell fallback or automatic download is performed.`)
}
