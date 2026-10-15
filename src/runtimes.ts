import type { OpsConfig, RuntimeAttempt, RuntimeKind, RuntimeResolution, RuntimeSet } from './types'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const upstreamRoot = fileURLToPath(new URL('./upstream/', import.meta.url))
export const upstreamModule = (file: string): string => new URL(`./upstream/lib/${file}`, import.meta.url).href

function unavailable(detail: string, tried: RuntimeAttempt[] = [], source = 'missing'): RuntimeResolution {
  return { available: false, source, detail, tried }
}

export function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function probeRuntime(kind: RuntimeKind | 'worker', file: string, env: NodeJS.ProcessEnv): string {
  if (!path.isAbsolute(file) || !fs.statSync(file).isFile())
    throw new Error('The selected executable must be an absolute regular file.')
  fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
  const args = kind === 'bash'
    // This is intentionally Bash interpolation, not a JavaScript template.
    // eslint-disable-next-line no-template-curly-in-string
    ? ['--noprofile', '--norc', '-c', 'set -o pipefail; test "${BASH_VERSINFO[0]}" -ge 3 && printf "dsh-ops-bash:%s:ok" "$BASH_VERSION"']
    : kind === 'pwsh'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']
      : ['--version']
  // PowerShell startup always writes a JIT profile; keep diagnostic caches out of the caller's home.
  const scratch = kind === 'pwsh' ? fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-next-pwsh-probe-')) : undefined
  let result
  try {
    const probeEnv = scratch
      ? {
          ...env,
          HOME: scratch,
          USERPROFILE: scratch,
          APPDATA: scratch,
          LOCALAPPDATA: scratch,
          XDG_CACHE_HOME: scratch,
          XDG_CONFIG_HOME: scratch,
          XDG_DATA_HOME: scratch,
          PSModuleAnalysisCachePath: path.join(scratch, 'ModuleAnalysisCache'),
          POWERSHELL_TELEMETRY_OPTOUT: '1',
          POWERSHELL_UPDATECHECK: 'Off',
        }
      : env
    result = spawnSync(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, env: probeEnv })
  }
  finally {
    if (scratch) {
      // mkdtemp returned this exact absolute path; this operation owns no other directory.
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  }
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Compatibility probe exited ${result.status}: ${result.stderr.trim().slice(0, 300)}`)
  const output = result.stdout.trim()
  const version = kind === 'bash'
    ? /^dsh-ops-bash:([\w.+()-]+):ok$/.exec(output)?.[1]
    : kind === 'pwsh'
      ? /^(?:[789]|\d{2,})\.\d+\.\d[-\w.]*$/.exec(output)?.[0]
      : kind === 'worker'
        ? /^dsh-ops-worker (\d+\.\d+\.\d+)$/.exec(output)?.[1]
        : /^fastctx (\d+\.\d+\.\d+)(?:\s.*)?$/i.exec(output)?.[1]
  if (!version)
    throw new Error(`Incompatible ${kind} identity or version: ${output.slice(0, 300)}`)
  if (kind === 'fastctx' && Number(version.split('.')[0]) === 0 && Number(version.split('.')[1]) < 2)
    throw new Error('FastCtx 0.2 or later with the upstream background tool protocol is required.')
  return version
}

async function probeFastctx(file: string, env: NodeJS.ProcessEnv, bash?: string): Promise<void> {
  const { McpStdioClient } = await import(upstreamModule('handshake.js'))
  const { childEnv } = await import(upstreamModule('tools.js'))
  const client = McpStdioClient.start({ file, args: ['serve', '--enable-shell'], timeoutMs: 5000, env: {
    ...childEnv(env),
    FASTCTX_BASH: bash ?? path.join(upstreamRoot, '.disabled-system-shell', 'bash'),
  } })
  try {
    const handshake = await client.initialize('dsh-ops-next-probe')
    if (!/fastctx/i.test(handshake?.serverInfo?.name ?? ''))
      throw new Error('The MCP server did not identify itself as FastCtx.')
    const tools: { name: string }[] = await client.listTools()
    for (const name of ['run_background', 'job_output', 'job_list', 'job_kill']) {
      if (!tools.some(tool => tool.name === name))
        throw new Error(`FastCtx is missing required capability ${name}.`)
    }
  }
  finally {
    await client.close()
  }
}

export async function resolveRuntime(kind: RuntimeKind, config: OpsConfig, env = process.env, bash?: string): Promise<RuntimeResolution> {
  const { isWslBashLauncher, wellKnownCandidates, executableNames, shellUpstreamPin, provisionedShellVersionDir } = await import(upstreamModule('shells.js'))
  const { managedBinaryFile } = await import(upstreamModule('binary.js'))
  const { childEnv } = await import(upstreamModule('tools.js'))
  const tried: RuntimeAttempt[] = []
  const explicit = kind === 'bash' ? config.bashPath : kind === 'pwsh' ? config.pwshPath : config.fastctxPath
  const localAllowed = config.runtimeMode === 'local-first' && config.allowLocalRuntimes
  const candidates: { file: string, source: string, managed?: boolean }[] = []
  if (localAllowed) {
    if (explicit) {
      candidates.push({ file: explicit, source: 'local:config' })
    }
    else {
      const names: string[] = kind === 'fastctx'
        ? process.platform === 'win32' ? ['fastctx.exe', 'fastctx'] : ['fastctx']
        : executableNames(kind, process.platform)
      for (const entry of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
        const directory = entry.trim().replace(/^"(.*)"$/, '$1')
        if (!path.isAbsolute(directory))
          continue
        for (const name of names) {
          const file = path.join(directory, name)
          if (fs.existsSync(file))
            candidates.push({ file, source: 'local:PATH' })
        }
      }
      if (kind !== 'fastctx') {
        for (const file of wellKnownCandidates({ kind, env, platform: process.platform }))
          candidates.push({ file, source: 'local:well-known' })
      }
    }
  }
  else {
    tried.push({ file: explicit || '(local discovery)', source: 'local', detail: config.runtimeMode === 'managed' ? 'Managed mode excludes local runtimes.' : 'Local runtime reuse has not been authorized; no local executable was probed.' })
    if (explicit && config.runtimeMode !== 'managed')
      return unavailable('The explicit local path requires authorization; nothing was executed or installed.', tried, 'local:config')
  }
  const pin = kind === 'fastctx' ? undefined : shellUpstreamPin({ kind })
  const managedFile = kind === 'fastctx'
    ? managedBinaryFile({ env })
    : pin && path.join(provisionedShellVersionDir({ kind, version: pin.version, env }), pin.executableRelativePath)
  if (managedFile)
    candidates.push({ file: managedFile, source: 'managed', managed: true })
  const visited = new Set<string>()
  for (const candidate of candidates) {
    if (visited.has(candidate.file))
      continue
    visited.add(candidate.file)
    try {
      if (kind === 'bash' && isWslBashLauncher(candidate.file, env, process.platform))
        throw new Error('The Windows WSL bash.exe launcher is not a supported local Bash runtime.')
      let expectedVersion: string | undefined
      if (candidate.managed) {
        if (kind === 'fastctx') {
          const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(candidate.file)), 'runtime.json'), 'utf8'))
          expectedVersion = /^version\s*=\s*"([\d.]+)"/m.exec(fs.readFileSync(path.join(upstreamRoot, 'vendor/fastctx/Cargo.toml'), 'utf8'))?.[1]
          if (!expectedVersion || receipt.schemaVersion !== 1 || receipt.executable !== candidate.file
            || receipt.executableName !== path.basename(candidate.file) || receipt.origin !== 'vendored source build'
            || receipt.version !== `fastctx ${expectedVersion}` || !/^[a-f0-9]{64}$/.test(receipt.sha256)
            || receipt.sha256 !== sha256(candidate.file)) {
            throw new Error('Managed FastCtx provenance mismatch; refusing execution.')
          }
        }
        else if (!pin?.executableSha256 || sha256(candidate.file) !== pin.executableSha256) {
          throw new Error('Managed shell digest does not match the pinned upstream executable; refusing execution.')
        }
      }
      const version = probeRuntime(kind, candidate.file, childEnv(env))
      if (expectedVersion && version !== expectedVersion)
        throw new Error(`Managed FastCtx version must match the pinned source: ${expectedVersion}.`)
      if (kind === 'fastctx')
        await probeFastctx(candidate.file, env, bash)
      const detail = candidate.managed ? 'Managed runtime verified against its recorded SHA-256; no system PATH changes.' : 'Authorized local runtime passed version/capability checks; it has no distribution-pinned digest guarantee.'
      tried.push({ file: candidate.file, source: candidate.source, detail })
      return { available: true, file: path.resolve(candidate.file), source: candidate.source, version, detail, tried }
    }
    catch (error) {
      tried.push({ file: candidate.file, source: candidate.source, detail: String(error instanceof Error ? error.message : error) })
      if (candidate.source === 'local:config')
        return unavailable('The explicit local path is authoritative but incompatible; correct it rather than silently using a different runtime.', tried, candidate.source)
    }
  }
  return unavailable(`No compatible ${kind} runtime. Run dsh-ops-next provision --${kind} for an explicit on-demand install${!pin && kind !== 'fastctx' ? '; this target has no managed shell pin, so authorize a supported local installation instead' : ''}.`, tried)
}

export async function resolveRuntimes(config: OpsConfig, env = process.env): Promise<RuntimeSet> {
  const needsBash = (config.enableShell && config.publishBashTool) || (config.enableBackground && config.enableShellTools)
  const bash = needsBash ? await resolveRuntime('bash', config, env) : unavailable('Bash component is disabled; no probing or download performed.', [], 'disabled')
  const pwsh = config.enableShell && process.platform === 'win32'
    ? await resolveRuntime('pwsh', config, env)
    : unavailable('PowerShell runtime overlay requires the Windows host pwsh-sandbox executor; no probing or download performed.', [], 'disabled')
  const fastctx = config.enableBackground && config.enableShellTools
    ? await resolveRuntime('fastctx', config, env, bash.file)
    : unavailable('Background component is disabled; no FastCtx probing or download performed.', [], 'disabled')
  return { bash, pwsh, fastctx }
}

export async function resolveNativeWorker(config: OpsConfig): Promise<RuntimeResolution> {
  if (!config.enableFile && !config.enablePtc)
    return unavailable('File and PTC components are disabled; native worker was not probed.', [], 'disabled')
  const explicit = config.runtimeMode === 'local-first' ? config.workerPath : ''
  if (explicit && !config.allowLocalRuntimes)
    return unavailable('Explicit workerPath requires authorized local-first reuse; no alternative was silently selected.', [], 'local:config')
  try {
    const { resolveWorker } = await import(upstreamModule('ptc/runtime.js'))
    const { childEnv } = await import(upstreamModule('tools.js'))
    const file: string = resolveWorker(explicit ? { binaryPath: explicit } : {}, { packageRoot: upstreamRoot, env: { ...process.env, DSH_OPS_WORKER_BIN: undefined } })
    const version = probeRuntime('worker', file, childEnv())
    if (version !== JSON.parse(fs.readFileSync(path.join(upstreamRoot, 'package.json'), 'utf8')).version)
      throw new Error('Native worker version must match the pinned upstream protocol.')
    return { available: true, file, version, source: explicit ? 'local:config' : 'managed:bundled', detail: explicit ? 'Authorized local worker passed identity/version checks; it has no distribution-pinned digest guarantee.' : 'Upstream native worker; packaged runtime provenance and sandbox boundaries are preserved.', tried: [] }
  }
  catch (error) {
    return unavailable(String(error instanceof Error ? error.message : error))
  }
}
