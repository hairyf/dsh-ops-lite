/** Cordis-free pins and discovery, shared by build, installer and read-only runtime resolution. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const SHELL_PROVISION_COMMAND = 'npx --package dsh-ops-lite dsh-ops-provision-shells'

/** Archive versions stay upstream-shaped; payloadVersion must be valid npm SemVer. */
export const SHELL_UPSTREAM_PINS = Object.freeze([
  Object.freeze({
    name: 'bash',
    label: 'Git for Windows PortableGit',
    platform: 'win32',
    arch: 'x64',
    payloadPackage: '@dshopslite/win32-x64-bash',
    payloadVersion: '2.56.0-windows.2',
    upstreamRepo: 'https://github.com/git-for-windows/git',
    releaseTag: 'v2.56.0.windows.2',
    version: '2.56.0.2',
    assetFile: 'PortableGit-2.56.0.2-64-bit.7z.exe',
    url: 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/PortableGit-2.56.0.2-64-bit.7z.exe',
    sha256: '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b',
    bytes: 60_027_568,
    license: 'GPL-2.0-only',
    extractor: 'sfx-7z',
    extractTo: '.',
    executableRelativePath: 'bin/bash.exe',
    executableSha256: '6cc575e9112efe6253b6a6999c12aa0240cb3f511aeda3480ae026edc0dc5280',
    msysSha256: '2a89b7c31b323c42e2fb37900af087aeb27417694e630a210bc75b0369410bc7',
  }),
  Object.freeze({
    name: 'pwsh',
    label: 'PowerShell',
    platform: 'win32',
    arch: 'x64',
    payloadPackage: '@dshopslite/win32-x64-pwsh',
    payloadVersion: '7.6.6',
    upstreamRepo: 'https://github.com/PowerShell/PowerShell',
    releaseTag: 'v7.6.6',
    version: '7.6.6',
    assetFile: 'PowerShell-7.6.6-win-x64.zip',
    url: 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip',
    sha256: '02fe458be20493fbdf43f61ea20610b811ee6c738ab1676c61b9cfcd1a33c860',
    bytes: 106_328_873,
    license: 'MIT',
    extractor: 'zip',
    extractTo: 'bin',
    executableRelativePath: 'bin/pwsh.exe',
    executableSha256: 'bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285',
  }),
])

export function shellUpstreamPin({ kind, platform = process.platform, arch = process.arch }) {
  return SHELL_UPSTREAM_PINS.find(pin => pin.name === kind && pin.platform === platform && pin.arch === arch)
}

export function shellStoreRoot({ env = process.env } = {}) {
  const home = env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  if (typeof home !== 'string' || !path.isAbsolute(home))
    throw new Error('DSH_HOME must be an absolute path for shell provisioning.')
  return path.join(home, 'dsh-ops', 'shells')
}

export function managedShellDirectory({ kind, env = process.env, platform = process.platform, arch = process.arch }) {
  const pin = shellUpstreamPin({ kind, platform, arch })
  return pin ? path.join(shellStoreRoot({ env }), kind, pin.payloadVersion) : undefined
}

export function payloadExecutable(pin) {
  return `vendor/${pin.name}/${pin.platform}-${pin.arch}/${pin.name === 'bash' ? 'bin/bash.exe' : 'pwsh.exe'}`
}

export function shellFileSha256(file) {
  if (!fs.statSync(file).isFile())
    throw new Error(`Shell executable is not a regular file: ${file}`)
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Same bin wrapper / usr/bin layout as confinedBash; no host-runtime imports needed. */
export function bashMsysFile(file) {
  const directory = path.dirname(file)
  const root = path.basename(directory).toLowerCase() === 'bin' && path.basename(path.dirname(directory)).toLowerCase() === 'usr'
    ? path.resolve(directory, '../..')
    : path.resolve(directory, '..')
  return path.join(root, 'usr/bin/msys-2.0.dll')
}

function validateMsys(file, pin) {
  if (!pin?.msysSha256 || shellFileSha256(bashMsysFile(file)) !== pin.msysSha256)
    throw new Error('Bash MSYS SHA256 mismatch; no verified DSH IPC compatibility build.')
}

/** Install-time only: execute a bounded, noninteractive identity probe before accepting local tools. */
export function validateLocalShell({ kind, file, env = process.env, platform = process.platform, arch = process.arch }) {
  if (!path.isAbsolute(file) || isWslBashLauncher(file, env, platform))
    throw new Error('Local shell must be an absolute, non-WSL executable.')
  const result = spawnSync(file, kind === 'bash' ? ['--noprofile', '--norc', '--version'] : ['-NoLogo', '-NoProfile', '--version'], {
    env,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64_000,
    windowsHide: true,
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Local ${kind} version probe failed (${result.signal ?? result.status}).`)
  const output = String(result.stdout ?? '')
  const version = (kind === 'bash' ? /GNU bash, version (\d+\.\d+(?:\.\d+)?)/ : /PowerShell (\d+\.\d+(?:\.\d+)?)/).exec(output)?.[1]
  if (!version || (kind === 'pwsh' && Number.parseInt(version) < 7))
    throw new Error(`Local ${kind} version unsupported: ${output.trim().slice(0, 160) || '(no version)'}`)
  if (kind === 'bash' && platform === 'win32')
    validateMsys(file, shellUpstreamPin({ kind, platform, arch }))
  return { file, detectedVersion: version }
}

/** Never trust an executable path or a digest supplied only by payload metadata. */
export function validateShellPayload(directory, pin) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const payload = JSON.parse(fs.readFileSync(path.join(directory, 'payload.json'), 'utf8'))
  const executable = payloadExecutable(pin)
  if (metadata.name !== pin.payloadPackage || metadata.version !== pin.payloadVersion
    || !Array.isArray(metadata.os) || !metadata.os.includes(pin.platform)
    || !Array.isArray(metadata.cpu) || !metadata.cpu.includes(pin.arch)
    || payload.kind !== pin.name || payload.target !== `${pin.platform}-${pin.arch}`
    || payload.version !== pin.payloadVersion || payload.executable !== executable || payload.sha256 !== pin.executableSha256) {
    throw new Error(`Shell payload metadata mismatch: ${pin.payloadPackage}@${pin.payloadVersion}`)
  }
  const file = path.join(directory, executable)
  const relative = path.relative(fs.realpathSync(directory), fs.realpathSync(file))
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
    || shellFileSha256(file) !== pin.executableSha256) {
    throw new Error(`Shell payload executable SHA256/path mismatch: ${pin.name}`)
  }
  if (pin.name === 'bash')
    validateMsys(file, pin)
  return file
}

/** Receipts are hints, never executable authority: validate constants and bytes on every read. */
export function managedShell({ kind, env = process.env, platform = process.platform, arch = process.arch, allowLocal = false }) {
  const pin = shellUpstreamPin({ kind, platform, arch })
  if (!pin)
    return undefined
  try {
    const directory = managedShellDirectory({ kind, env, platform, arch })
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, '.provisioned.json'), 'utf8'))
    if (receipt.kind !== kind || receipt.target !== `${platform}-${arch}` || receipt.version !== pin.payloadVersion)
      return undefined
    if (receipt.source === 'payload' && receipt.sha256 === pin.executableSha256) {
      const file = validateShellPayload(path.join(directory, 'node_modules', pin.payloadPackage), pin)
      return { file, source: 'provisioned', detail: `verified managed ${pin.payloadPackage}@${pin.payloadVersion}: ${file}` }
    }
    if (allowLocal && receipt.source === 'local' && typeof receipt.file === 'string' && path.isAbsolute(receipt.file)
      && executableNames(kind, platform).includes(path.basename(receipt.file).toLowerCase())
      && !isWslBashLauncher(receipt.file, env, platform)
      && /^\d+\.\d+(?:\.\d+)?$/.test(receipt.detectedVersion)
      && (kind !== 'pwsh' || Number.parseInt(receipt.detectedVersion) >= 7)
      && /^[a-f0-9]{64}$/.test(receipt.sha256) && shellFileSha256(receipt.file) === receipt.sha256) {
      if (kind === 'bash' && platform === 'win32')
        validateMsys(receipt.file, pin)
      return { file: receipt.file, detectedVersion: receipt.detectedVersion, source: 'local', detail: `verified local ${kind} ${receipt.detectedVersion}; system fallback explicitly permitted` }
    }
  }
  catch {}
  return undefined
}

function isSpawnableFile(file) {
  try {
    const stat = fs.lstatSync(file)
    return stat.isFile() || stat.isSymbolicLink()
  }
  catch { return false }
}

export function isWslBashLauncher(file, env, platform) {
  if (platform !== 'win32' || typeof file !== 'string')
    return false
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
  if (!systemRoot?.trim())
    return false
  const normalize = value => path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase()
  return normalize(file) === normalize(path.win32.join(systemRoot, 'System32', 'bash.exe'))
}

function wellKnownCandidates({ kind, env, platform }) {
  if (platform !== 'win32')
    return []
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = env.LOCALAPPDATA ?? env.LocalAppData ?? ''
  const userProfile = env.USERPROFILE ?? ''
  return (kind === 'bash'
    ? [
        path.join(programFiles, 'Git', 'bin', 'bash.exe'),
        path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
        path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
        localAppData === '' ? '' : path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
        userProfile === '' ? '' : path.join(userProfile, 'scoop', 'shims', 'bash.exe'),
        userProfile === '' ? '' : path.join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
        'C:\\ProgramData\\chocolatey\\bin\\bash.exe',
        'C:\\tools\\msys64\\usr\\bin\\bash.exe',
        'C:\\msys64\\usr\\bin\\bash.exe',
      ]
    : [
        path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
        path.join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
        path.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'),
        localAppData === '' ? '' : path.join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
        userProfile === '' ? '' : path.join(userProfile, 'scoop', 'shims', 'pwsh.exe'),
        'C:\\ProgramData\\chocolatey\\bin\\pwsh.exe',
      ]).filter(file => file !== '')
}

function executableNames(kind, platform) {
  return platform === 'win32' ? [`${kind}.exe`, kind] : [kind]
}

/** Ambient discovery; identity processes run only when the installer requests validation. */
export function systemShell({ kind, env = process.env, platform = process.platform, arch = process.arch, validate = false, warn = console.warn }) {
  const seen = new Set()
  const candidate = (file, source) => {
    if (seen.has(file) || !isSpawnableFile(file) || (kind === 'bash' && isWslBashLauncher(file, env, platform)))
      return undefined
    seen.add(file)
    try {
      const verified = validate ? validateLocalShell({ kind, file, env, platform, arch }) : { file }
      return { ...verified, source, detail: `${kind}${verified.detectedVersion ? ` ${verified.detectedVersion}` : ''} found at ${file}` }
    }
    catch (error) {
      warn(`dsh-ops-lite: rejected local ${kind}: ${file}: ${error.message ?? error}; trying another candidate or the managed payload.`)
      return undefined
    }
  }
  const names = executableNames(kind, platform)
  for (const entry of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!path.isAbsolute(directory))
      continue
    for (const name of names) {
      const file = path.join(directory, name)
      const found = candidate(file, 'path')
      if (found)
        return found
    }
  }
  for (const file of wellKnownCandidates({ kind, env, platform })) {
    const found = candidate(file, 'well-known')
    if (found)
      return found
  }
  return undefined
}
