/** npm is used only here, from the install/repair script; runtime resolution never imports this module. */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { managedShell, managedShellDirectory, SHELL_PROVISION_COMMAND, shellFileSha256, shellUpstreamPin, systemShell, validateShellPayload } from './shell-payloads.js'

function writeReceipt(directory, value) {
  fs.mkdirSync(directory, { recursive: true })
  const temporary = path.join(directory, `.provisioned-${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    fs.renameSync(temporary, path.join(directory, '.provisioned.json'))
  }
  finally { fs.rmSync(temporary, { force: true }) }
}

/** Run npm's JS CLI directly on Windows, never interpolate a shell command or spawn npm.cmd. */
function installPayload(directory, pin, env, platform) {
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(entry => path.isAbsolute(entry)).map(entry => path.join(entry, 'node_modules/npm/bin/npm-cli.js')),
  ]
  const cli = candidates.find(file => typeof file === 'string' && path.basename(file) === 'npm-cli.js' && fs.existsSync(file))
  if (!cli && platform === 'win32')
    throw new Error('npm CLI not found; install Node.js with npm and run the repair command again.')
  const args = ['install', '--prefix', directory, '--global=false', '--workspaces=false', '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund', `${pin.payloadPackage}@${pin.payloadVersion}`]
  const result = spawnSync(cli ? process.execPath : 'npm', cli ? [cli, ...args] : args, { cwd: directory, env, stdio: 'inherit', windowsHide: true, timeout: 600_000 })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`npm shell payload installation failed (${result.signal ?? result.status}).`)
}

/** Synchronous install-time work, isolated under DSH_HOME; failures never block the other shell. */
export function provisionShells({ env = process.env, platform = process.platform, arch = process.arch, warn = console.warn } = {}) {
  if (env.DSH_OPS_SKIP_SHELL_PAYLOAD === '1')
    return { failed: false, shells: [] }
  const selection = env.DSH_OPS_SHELLS ?? 'both'
  if (!['bash', 'pwsh', 'both', 'none'].includes(selection))
    throw new Error('DSH_OPS_SHELLS must be bash, pwsh, both, or none.')
  if (selection === 'none' || platform !== 'win32' || arch !== 'x64')
    return { failed: false, shells: [] }
  const shells = []
  let failed = false
  for (const kind of selection === 'both' ? ['bash', 'pwsh'] : [selection]) {
    try {
      const pin = shellUpstreamPin({ kind, platform, arch })
      const directory = managedShellDirectory({ kind, env, platform, arch })
      const identity = { kind, target: `${platform}-${arch}`, version: pin.payloadVersion }
      // A valid pinned payload wins over ambient shells and is rehashed on every invocation.
      let existing
      try {
        existing = validateShellPayload(path.join(directory, 'node_modules', pin.payloadPackage), pin)
      }
      catch {}
      if (existing) {
        writeReceipt(directory, { ...identity, source: 'payload', sha256: pin.executableSha256 })
        shells.push({ kind, source: 'provisioned', file: existing })
        continue
      }
      const saved = managedShell({ kind, env, platform, arch, allowLocal: true })
      const local = env.DSH_OPS_FORCE_MANAGED_SHELLS === '1'
        ? undefined
        : saved?.source === 'local' ? saved : systemShell({ kind, env, platform, arch, validate: true, warn })
      if (local) {
        const file = path.resolve(local.file)
        writeReceipt(directory, { ...identity, source: 'local', file, detectedVersion: local.detectedVersion, sha256: shellFileSha256(file) })
        warn(`dsh-ops-lite: reusing local ${kind} ${local.detectedVersion}: ${file}; no payload downloaded. Runtime requires ${kind === 'bash' ? 'bashPath or ' : ''}allowSystemShellFallback=true; this installer does not grant that permission. To use a managed payload run ${SHELL_PROVISION_COMMAND} --force-managed.`)
        shells.push({ kind, source: 'local', file, detectedVersion: local.detectedVersion })
        continue
      }
      fs.mkdirSync(path.dirname(directory), { recursive: true })
      // Validate a fresh installation before publishing; never remove a working generation on npm failure.
      const staging = fs.mkdtempSync(path.join(path.dirname(directory), `${pin.payloadVersion}-stage-`))
      try {
        installPayload(staging, pin, env, platform)
        validateShellPayload(path.join(staging, 'node_modules', pin.payloadPackage), pin)
        writeReceipt(staging, { ...identity, source: 'payload', sha256: pin.executableSha256 })
        const previous = `${directory}-previous-${randomUUID()}`
        if (fs.existsSync(directory))
          fs.renameSync(directory, previous)
        try {
          fs.renameSync(staging, directory)
        }
        catch (error) {
          if (fs.existsSync(previous))
            fs.renameSync(previous, directory)
          throw error
        }
        // Old generations may be in use on Windows; retaining one is safer than failing a valid repair.
        try {
          fs.rmSync(previous, { recursive: true, force: true })
        }
        catch { warn(`dsh-ops-lite: old shell generation retained at ${previous}; remove it after stopping its shell processes.`) }
        shells.push({ kind, source: 'provisioned', file: path.join(directory, 'node_modules', pin.payloadPackage, 'vendor', kind, `${platform}-${arch}`, kind === 'bash' ? 'bin/bash.exe' : 'pwsh.exe') })
      }
      finally { fs.rmSync(staging, { recursive: true, force: true }) }
    }
    catch (error) {
      failed = true
      warn(`dsh-ops-lite: could not provision ${kind}: ${error.message ?? error}. Retry with ${SHELL_PROVISION_COMMAND}. To skip payloads set DSH_OPS_SKIP_SHELL_PAYLOAD=1 or DSH_OPS_SHELLS=none. Runtime will not download shells.`)
    }
  }
  return { failed, shells }
}
