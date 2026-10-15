/**
 * Resolve shells without writing PATH, profiles or the working directory.
 * Windows shells come from the exact npm runtime package; Unix uses system Bash.
 * Configured Bash paths remain authoritative. Missing runtime packages fail closed;
 * there is no provisioner, download or compilation fallback.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { PACKAGE_ROOT, runtimeRoot } from './binary.js'
import { publicToolName } from './policy.js'

/** The directory this module was loaded from; the resolution root of a checkout. */
const MODULE_ROOT = PACKAGE_ROOT

/** Model-facing name of the tool this module publishes for the bash rung. */
export const BASH_TOOL_NAME = publicToolName('bash')

/** Default foreground deadline for one `ops_bash` command, in milliseconds. */
export const DEFAULT_BASH_TIMEOUT_MS = 120_000

/** Upper bound for a per-call `timeoutMs`, in milliseconds. */
export const MAX_BASH_TIMEOUT_MS = 2_147_483_647

/**
 * Grace period handed to `ctx.subprocess` for its SIGTERM→SIGKILL escalation,
 * matching the upstream bash executor's default
 * (`packages/shell/bash-local/src/index.ts:35`).
 */
export const DEFAULT_GRACE_MS = 3_000

/** Per-stream in-memory cap, matching the upstream executor default. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64_000

/** Per-stream spill-file cap; a larger stream keeps only its in-memory tail. */
export const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024

/**
 * Every argument `ops_bash` declares, in schema order.
 *
 * `execute` enforces this list while `parameters.properties` documents it, and
 * the two are written separately, so they can drift: a name added to the schema
 * but not here would be refused as unknown, and a name kept here after the
 * schema drops it would silently pass through. `test/shells.test.mjs` pins the
 * two against each other.
 */
export const BASH_ARGUMENTS = Object.freeze(['command', 'description', 'script_path', 'workdir', 'timeoutMs', 'graceMs'])

/**
 * Model-friendly environment overrides: disable colors, pagers, and interactive
 * terminal features that would garble tool output. This is the upstream bash
 * executor's set verbatim (`packages/shell/bash-local/src/index.ts:27-32`),
 * passed as an explicit `env`, which the subprocess service merges AFTER its
 * ambient credential scrub.
 */
export const ENV_OVERRIDES = Object.freeze({
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
})

/** Windows vendor layouts within the exact npm runtime package. */
const SHELL_LAYOUTS = Object.freeze({
  bash: { executable: 'bash.exe', vendor: 'bash' },
  pwsh: { executable: 'pwsh.exe', vendor: 'pwsh' },
})

/**
 * The upstream release each bundled shell is pinned to.
 *
 * CI/development builds use these exact archives and digests when assembling
 * the Windows npm runtime package. Plugin loading never downloads them.
 *
 * - `sha256` is the digest of the archive exactly as published upstream;
 * - `executableSha256` is checked by the build after unpacking;
 * - `extractor` says how the archive is opened (`zip` through Windows' own
 *   bsdtar, `sfx-7z` by running the archive's own self-extractor) and
 *   `extractTo` where the archive's ROOT lands inside the version directory, so
 *   the executable ends up at `<extractTo>/<file name>`.
 *
 * The two layouts differ on purpose: the PowerShell zip holds `pwsh.exe` at its
 * root and is unpacked into `bin/`, while PortableGit's self-extracting archive
 * holds the whole Git tree — `bin/bash.exe` included — and is unpacked at the
 * version root.
 */
export const SHELL_UPSTREAM_PINS = Object.freeze([
  Object.freeze({
    name: 'bash',
    label: 'Git for Windows PortableGit',
    platform: 'win32',
    arch: 'x64',
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
  }),
  Object.freeze({
    name: 'pwsh',
    label: 'PowerShell',
    platform: 'win32',
    arch: 'x64',
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

/**
 * The pin for one shell on one platform.
 * @param {object} options - the lookup.
 * @param {'bash'|'pwsh'} options.kind - which shell.
 * @param {string} [options.platform] - `process.platform`.
 * @param {string} [options.arch] - `process.arch`.
 * @returns {object|undefined} the pin, or undefined when this platform has none.
 */
export function shellUpstreamPin({ kind, platform = process.platform, arch = process.arch }) {
  return SHELL_UPSTREAM_PINS.find(pin => (
    pin.name === kind && pin.platform === platform && pin.arch === arch
  ))
}

/**
 * One shell rung's resolution.
 * @typedef {object} ShellResolution
 * @property {boolean} available - whether this rung can run right now.
 * @property {string|undefined} file - the resolved executable, when available.
 * @property {string} source - where the answer came from, for reports and tests.
 *   One of `disabled`, `config`, `bundled`, `path`, `well-known`,
 *   `missing`.
 * @property {string} detail - a one-line English explanation, for reports.
 */

/**
 * Whether a candidate names something this process can spawn.
 *
 * `lstat` is used deliberately: a symlink (the Node shape of a Windows Store
 * app-execution alias) is a valid executable even when its target is not
 * statable, a real directory never is, and any unexpected error answers `false`
 * rather than throwing out of a load-time probe.
 * @param {string|undefined} file - the candidate path.
 * @returns {boolean} whether the candidate exists and is not a directory.
 */
function isSpawnableFile(file) {
  if (typeof file !== 'string' || file === '')
    return false
  try {
    const stat = fs.lstatSync(file)
    return stat.isFile() || stat.isSymbolicLink()
  }
  catch {
    return false
  }
}

/**
 * The `<platform>-<arch>` infix both the platform packages and the vendored
 * layout use (`win32-x64`).
 * @param {string} platform - `process.platform`.
 * @param {string} arch - `process.arch`.
 * @returns {string} the key.
 */
function platformKey(platform, arch) {
  return `${platform}-${arch}`
}

/**
 * The vendored bundled shell inside the package, whether or not it exists.
 * @param {object} options - resolution inputs.
 * @param {'bash'|'pwsh'} options.kind - which rung.
 * @param {string} options.bundleRoot - the plugin package root.
 * @param {string} options.platform - `process.platform`.
 * @param {string} options.arch - `process.arch`.
 * @returns {string} the path the bundled copy would occupy.
 */
export function bundledShellPath({ kind, bundleRoot, platform, arch }) {
  const target = SHELL_LAYOUTS[kind]
  const root = platform === 'win32' ? runtimeRoot({ packageRoot: bundleRoot, platform, arch }) : bundleRoot
  return path.join(root, 'vendor', target.vendor, platformKey(platform, arch), ...(kind === 'bash' && platform === 'win32' ? ['bin'] : []), target.executable)
}

/** @typedef {'incomplete-tree'} BundledCause */

/**
 * The plugin's own copy of one shell, from whichever layout carries it: the
 * installed platform package first, then the vendored subdirectory.
 *
 * `cause` is carried alongside `detail` so a caller that has to act on the
 * miss — {@link resolveBash} chooses which remedy to print — reads a fact
 * instead of parsing the sentence. It is additive: callers that only read
 * `file`/`detail` are unaffected.
 * @param {object} options - resolution inputs.
 * @param {'bash'|'pwsh'} options.kind - which rung.
 * @param {string} options.bundleRoot - the plugin package root.
 * @param {string} options.platform - `process.platform`.
 * @param {string} options.arch - `process.arch`.
 * @returns {{file: string|undefined, detail: string|undefined, cause: BundledCause|undefined}}
 *   the executable and, when there is none, why the plugin's own copy is
 *   unusable — as text for a report, and as the cause behind it.
 */
export function bundledShell({ kind, bundleRoot, platform, arch }) {
  const file = bundledShellPath({ kind, bundleRoot, platform, arch })
  return isSpawnableFile(file)
    ? { file, detail: undefined, cause: undefined }
    : { file: undefined, detail: `Runtime package does not contain ${kind}: ${file}`, cause: 'incomplete-tree' }
}

/**
 * One executable found by walking a PATH-shaped string.
 *
 * This is a read-only walk of the value it was handed: it never writes PATH and
 * never consults anything but the string it is given.
 * @param {object} options - search inputs.
 * @param {string[]} options.names - executable names to accept, in order.
 * @param {string|undefined} options.pathValue - the PATH value to walk.
 * @param {(file: string) => boolean} [options.reject] - reject a discovered candidate.
 * @returns {string|undefined} the first existing entry, or undefined.
 */
function fromPath({ names, pathValue, reject }) {
  if (typeof pathValue !== 'string' || pathValue.trim() === '')
    return undefined
  for (const entry of pathValue.split(path.delimiter)) {
    // PATH entries may carry surrounding quotes from `setx`-style definitions.
    const directory = entry.trim().replace(/^"(.*)"$/, '$1')
    if (directory === '' || !path.isAbsolute(directory))
      continue
    for (const name of names) {
      const file = path.join(directory, name)
      if (isSpawnableFile(file) && !(reject?.(file) ?? false))
        return file
    }
  }
  return undefined
}

/**
 * Windows ships `%SystemRoot%\\System32\\bash.exe` as the WSL distribution
 * launcher, not as a POSIX shell. Treating it as a normal PATH bash silently
 * moves commands into a Linux distribution, so it must never be selected by
 * the system fallback. `path.win32` is intentional: tests can exercise the
 * Windows resolver while running on another host platform.
 * @param {string} file - candidate executable.
 * @param {NodeJS.ProcessEnv} env - environment containing SystemRoot.
 * @param {string} platform - target platform.
 * @returns {boolean} whether the candidate is the WSL launcher.
 */
function isWslBashLauncher(file, env, platform) {
  if (platform !== 'win32')
    return false
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
  if (typeof systemRoot !== 'string' || systemRoot.trim() === '')
    return false
  const normalize = value => path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase()
  return normalize(file) === normalize(path.win32.join(systemRoot, 'System32', 'bash.exe'))
}

/**
 * The well-known install locations to probe for one rung.
 *
 * The bash list deliberately omits `%SystemRoot%\System32\bash.exe`: that is the
 * WSL distribution launcher, not a POSIX shell over the caller's filesystem, so
 * spawning it would silently run the command on a different machine. The pwsh
 * list keeps Windows PowerShell 5.1 last, matching upstream's own resolution
 * order (`packages/shell/pwsh-local/src/resolve.ts:21-37`).
 * @param {object} options - probe inputs.
 * @param {'bash'|'pwsh'} options.kind - which rung.
 * @param {NodeJS.ProcessEnv} options.env - the environment to read.
 * @param {string} options.platform - `process.platform`.
 * @returns {string[]} the candidate paths, in order.
 */
function wellKnownCandidates({ kind, env, platform }) {
  if (platform !== 'win32')
    return []
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = env.LOCALAPPDATA ?? env.LocalAppData ?? ''
  const userProfile = env.USERPROFILE ?? ''
  const candidates = kind === 'bash'
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
      ]
  return candidates.filter(file => file !== '')
}

/**
 * The executable names one rung answers to.
 * @param {'bash'|'pwsh'} kind - which rung.
 * @param {string} platform - `process.platform`.
 * @returns {string[]} the names, in probe order.
 */
function executableNames(kind, platform) {
  const base = kind === 'bash' ? 'bash' : 'pwsh'
  return platform === 'win32' ? [`${base}.exe`, base] : [base]
}

/**
 * The remedy for a bash this deployment cannot place at all: the one action
 * that is right whatever the cause was, and therefore the one both the load
 * time detail and the spawn time failure fall back to. It is written once
 * because it is one decision — the spawn wording only adds the sentence's
 * closing period.
 */
const GENERIC_BASH_REMEDY = 'reinstall dsh-ops-lite with optional dependencies enabled; no download or compilation fallback is used'

/**
 * Resolve the bash rung: explicit config, the npm runtime package, then — only
 * while the deployment allows a system shell — PATH and the
 * well-known install locations.
 *
 * A configured path is authoritative: when it is unusable the rung reports
 * `available: false` instead of quietly running a different shell.
 * @param {object} options - resolution inputs.
 * @param {string|undefined} options.configured - the configured executable.
 * @param {string|undefined} options.bundled - the plugin's own executable, when it has one.
 * @param {string|undefined} options.bundledDetail - why the plugin's own copy is unusable, when it has none.
 * @param {boolean} options.allowSystemFallback - whether system installations may be used.
 * @param {NodeJS.ProcessEnv} options.env - the environment to read.
 * @param {string} options.platform - `process.platform`.
 * @returns {ShellResolution} the resolution.
 */
function resolveBash({
  configured,
  bundled,
  bundledDetail,
  allowSystemFallback,
  env,
  platform,
}) {
  if (configured !== undefined) {
    return isSpawnableFile(configured)
      ? { available: true, file: configured, source: 'config', detail: 'configured bash executable' }
      : {
          available: false,
          file: undefined,
          source: 'config',
          detail: `the configured bash executable does not exist: ${configured}`,
        }
  }
  if (bundled !== undefined) {
    return {
      available: true,
      file: bundled,
      source: 'bundled',
      detail: 'the plugin\'s own bash',
    }
  }
  if (!allowSystemFallback) {
    return {
      available: false,
      file: undefined,
      source: 'disabled',
      detail: `no bundled bash and allowSystemShellFallback is false${
        bundledDetail === undefined ? '' : ` (${bundledDetail})`
      }; ${GENERIC_BASH_REMEDY}`,
    }
  }
  const onPath = fromPath({
    names: executableNames('bash', platform),
    pathValue: env.PATH ?? env.Path,
    reject: file => isWslBashLauncher(file, env, platform),
  })
  if (onPath !== undefined) {
    return { available: true, file: onPath, source: 'path', detail: 'bash found on PATH' }
  }
  for (const candidate of wellKnownCandidates({ kind: 'bash', env, platform })) {
    if (isSpawnableFile(candidate)) {
      return { available: true, file: candidate, source: 'well-known', detail: 'well-known bash install' }
    }
  }
  return {
    available: false,
    file: undefined,
    source: 'missing',
    detail: `no bash found by config, the runtime package, PATH, or a well-known `
      + `install location${
        bundledDetail === undefined ? '' : ` (${bundledDetail})`
      }; ${GENERIC_BASH_REMEDY}`,
  }
}

/**
 * Resolve the PowerShell 7 rung.
 *
 * L3 is "the plugin's own pwsh 7", and whether that rung runs is decided by the
 * executable it needs actually being there: `cordis.patch.yml` points the
 * host's `pwsh-sandbox` row at this same path whenever it exists, so
 * `available` here and the host row's behaviour are one fact, not two. There is
 * deliberately no configured-path form: the row the plugin would have to
 * rewrite is resolved before any dsh-ops config is read.
 * @param {object} options - resolution inputs.
 * @param {string|undefined} options.bundled - the plugin's own pwsh, when it has one.
 * @param {string|undefined} options.bundledDetail - why the plugin's own copy is unusable, when it has none.
 * @param {boolean} options.allowSystemFallback - whether the host's pwsh may serve as the last rung.
 * @returns {ShellResolution} the resolution.
 */
function resolvePwsh({ bundled, bundledDetail, allowSystemFallback }) {
  if (bundled !== undefined) {
    return {
      available: true,
      file: bundled,
      source: 'bundled',
      detail: 'the plugin\'s own PowerShell 7, which the pwsh-sandbox override points at',
    }
  }
  return {
    available: false,
    file: undefined,
    source: 'missing',
    detail: `the plugin carries no PowerShell 7 for this platform${
      bundledDetail === undefined ? '' : ` (${bundledDetail})`
    }; reinstall dsh-ops-lite with optional dependencies enabled on Windows${
      allowSystemFallback
        ? '; the host\'s own pwsh tool is the ladder\'s last rung'
        : '; allowSystemShellFallback is false, so the ladder has no PowerShell rung'}`,
  }
}

/**
 * Resolve both shell rungs for this configuration.
 *
 * Synchronous, side-effect free, and total: every failure mode becomes a
 * resolution with `available: false`, never a throw, because this runs during
 * mount where an exception would take the whole plugin down.
 * @param {import('./config.js').ResolvedConfig} config - the plugin configuration.
 * @param {object} [options] - resolution overrides, for tests and for a host
 *   resolving against a different root. Production callers pass none.
 * @param {string} [options.bundleRoot] - the plugin package root.
 * @param {NodeJS.ProcessEnv} [options.env] - the environment to probe.
 * @param {string} [options.platform] - `process.platform`.
 * @param {string} [options.arch] - `process.arch`.
 * @returns {{bash: ShellResolution, pwsh: ShellResolution}} one resolution per rung.
 */
export function resolveShells(config, options = {}) {
  const bundleRoot = options.bundleRoot ?? MODULE_ROOT
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const allowSystemFallback = config?.allowSystemShellFallback === true
  const probe = { bundleRoot, env, platform, arch }
  const pwshBundled = bundledShell({ kind: 'pwsh', ...probe })

  const pwsh = resolvePwsh({
    bundled: pwshBundled.file,
    bundledDetail: pwshBundled.detail,
    allowSystemFallback,
  })

  if (config?.publishBashTool === false) {
    return {
      bash: {
        available: false,
        file: undefined,
        source: 'disabled',
        detail: 'publishBashTool is false',
      },
      pwsh,
    }
  }

  const bashBundled = bundledShell({ kind: 'bash', ...probe })
  return {
    bash: resolveBash({
      configured: config?.bashPath,
      bundled: bashBundled.file,
      bundledDetail: bashBundled.detail,
      allowSystemFallback,
      env,
      platform,
    }),
    pwsh,
  }
}

/**
 * Reject a value this tool cannot run with, naming the field.
 * @param {string} name - the argument name.
 * @param {number} value - the value to check.
 * @returns {void}
 * @throws {Error} when the value is not a positive finite number.
 */
function assertPositiveFinite(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid ${name}: expected a positive finite number, got ${JSON.stringify(value)}`)
  }
}

/**
 * Refuse arguments this tool does not declare.
 *
 * A first-party tool built with the harness's `defineTool` gets its arguments
 * checked against the parameter schema before its body runs
 * (`dsh-tools/lib/index.js`: `validate(args)` → `ToolArgsError`). This plugin
 * registers a plain definition through `ctx.tools.register` instead, to stay
 * free of any `@deepseek-ai/*` value import, and that path validates only
 * `output.schema`: the model's arguments reach `execute` verbatim. Reading the
 * known fields with `args?.name` then drops an undeclared key in silence — the
 * call reports success while ignoring what the caller asked for.
 *
 * `run_in_background` is the costly case, because the host's own `bash` and
 * `pwsh` tools really do accept it. A command that never exits (a server, a
 * watcher) then runs in the foreground and occupies the call for the whole
 * `timeoutMs`, which may be as much as {@link MAX_BASH_TIMEOUT_MS}.
 * @param {unknown} args - the model arguments.
 * @param {readonly string[]} known - the argument names the schema declares.
 * @returns {void}
 * @throws {Error} when `args` is not an object, or carries an undeclared key.
 */
function assertKnownArguments(args, known) {
  if (args === undefined || args === null)
    return
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(`invalid arguments: expected an object, got ${JSON.stringify(args)}`)
  }
  const unknown = Object.keys(args).filter(key => !known.includes(key))
  if (unknown.length === 0)
    return
  const names = unknown.map(key => JSON.stringify(key)).join(', ')
  throw new Error(`invalid arguments: unknown ${unknown.length === 1 ? 'key' : 'keys'} ${names}; `
    + `this tool accepts ${known.join(', ')}`)
}

/**
 * Compose the model-facing text for one settled run.
 *
 * The shape matches the host's own bash tool
 * (`packages/shell/tool-bash/src/render.ts`): the body is stdout, then a marked
 * stderr section, then interruption markers, with `[exit code: N]` last so a
 * reader can anchor on it. A non-zero exit is reported rather than raised; only
 * an infrastructure failure (a spawn failure) rejects the call.
 * @param {object} value - the canonical result value.
 * @returns {string} the rendered text.
 */
export function renderBashResult(value) {
  const stream = output => (output.truncated
    ? `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
    : output.text)
  const out = stream(value.stdout)
  const err = stream(value.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n'))
      body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0)
    body = '(no output)'
  const markers = []
  if (value.permission)
    markers.push(`[${value.permission.code}: ${value.permission.message} ${value.permission.nextAction}]`)
  if (value.error !== undefined)
    markers.push(`[error: ${value.error}]`)
  if (value.timedOut === true)
    markers.push(`[timed out after ${value.timeoutMs}ms]`)
  if (value.signal !== undefined)
    markers.push(`[signal: ${value.signal}]`)
  if (value.exitCode !== undefined && value.exitCode !== 0)
    markers.push(`[exit code: ${value.exitCode}]`)
  return [body, ...markers].join('\n')
}

/**
 * Read one settled collect-mode stream as its complete retained output.
 * @param {{readFrom: (from: number) => {text: string, lossy: boolean, spillPath?: string}}|undefined} reader - the reader.
 * @returns {{text: string, truncated: boolean, spillPath?: string}} the canonical stream value.
 */
function settledStream(reader) {
  if (reader === undefined || typeof reader.readFrom !== 'function')
    return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy === true,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

/**
 * The canonical output contract of `ops_bash`, as plain JSON Schema.
 *
 * EVERY `type` here is a single type string: the harness's
 * `assertSupportedJsonSchema` rejects type arrays outright ("type arrays are
 * not supported", `packages/core/tools/src/json-schema.ts:302-307`), so
 * `['integer', 'null']` is a definition the real registry refuses to register.
 * "Nothing to report" is expressed by OMITTING the key, never by a `null`, which
 * is why `exitCode` and `signal` are optional rather than nullable.
 */
const BASH_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['timedOut', 'timeoutMs', 'stdout', 'stderr'],
  properties: {
    exitCode: { type: 'integer' },
    signal: { type: 'string' },
    error: { type: 'string' },
    permission: { type: 'object' },
    sandbox: { type: 'object' },
    timedOut: { type: 'boolean' },
    timeoutMs: { type: 'number' },
    stdout: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'truncated'],
      properties: {
        text: { type: 'string' },
        truncated: { type: 'boolean' },
        spillPath: { type: 'string' },
      },
    },
    stderr: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'truncated'],
      properties: {
        text: { type: 'string' },
        truncated: { type: 'boolean' },
        spillPath: { type: 'string' },
      },
    },
  },
})

/**
 * The model-facing description of the bash rung.
 *
 * It states the rung's position in the ladder and the recovery step on failure,
 * so the model fixes the command instead of switching shells — the same contract
 * `lib/policy.js` renders into the prompt.
 * @returns {string} the description.
 */
export function bashToolDescription() {
  return 'Run general commands, builds, git/gh, pipelines and scripts in bash; prefer this command '
    + 'executor over PowerShell. Use file tools for file operations. Each call uses a fresh non-login '
    + 'shell; set workdir explicitly. For scripts longer than about 1 KB or containing heredocs, '
    + 'quotes, backslashes or non-ASCII text, write the script to a file first and pass script_path '
    + 'instead of embedding it in command. Use command for short commands and pipelines. Fix failed '
    + 'bash commands here, do not switch shells or mix PowerShell syntax. Output is bounded with '
    + 'spill paths; verify absolute targets before delete/move. Foreground only: no run_in_background '
    + 'and no job id, so a server or watcher occupies the call until timeoutMs; use host pwsh for background.'
}

/**
 * One `ops_bash` tool definition, bound to the resolved bash executable.
 *
 * The definition is a plain object — no `@deepseek-ai/*` value import, at load
 * time or later — and it is registered through the caller's own
 * `ctx.tools.register`, never by rewriting the shared registry. Its one host
 * dependency, the subprocess service, is read with `ctx.get('subprocess')`:
 * reaching a host service through `ctx.get` needs no import, and it buys the
 * harness's real credential scrub and process governance instead of a
 * hand-rolled spawn.
 * @param {object} options - the tool inputs.
 * @param {string} options.file - the resolved bash executable.
 * @param {string} options.source - where that executable came from, for diagnostics.
 * @param {{spawn: (spec: object) => object}} options.subprocess - the harness subprocess service.
 * @param {(argv: string[], signal: AbortSignal) => Promise<string[]>} [options.prepareArgv] - prepare authoritative confinement arguments.
 * @param {NodeJS.ProcessEnv} [options.env] - explicit child environment overrides.
 * @returns {object} the definition `ctx.tools.register()` accepts.
 */
export function bashToolDefinition({ file, source, subprocess, prepareArgv, env = {} }) {
  return {
    name: BASH_TOOL_NAME,
    description: bashToolDescription(),
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Short bash command or pipeline. Omit or leave empty when using script_path.',
        },
        description: {
          type: 'string',
          description: 'Short human-readable description of the command; accepted for compatibility with the host shell tool.',
        },
        script_path: {
          type: 'string',
          description: 'Existing bash script path. Omit or leave empty when using command. Never use /dev/null as a placeholder.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory; defaults to the session workspace when omitted.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds; the command is killed on expiry. '
            + `Defaults to ${DEFAULT_BASH_TIMEOUT_MS}.`,
        },
        graceMs: {
          type: 'number',
          description: 'Grace period in milliseconds between termination and a forced kill. '
            + `Defaults to ${DEFAULT_GRACE_MS}.`,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: BASH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderBashResult(value) }],
    },
    /**
     * Run one command through the harness subprocess service.
     *
     * The service owns credential scrubbing, output spilling, and process-range
     * termination; this body supplies only the argv, the directory, the budgets,
     * the terminal overrides, and its cancellation.
     * @param {Record<string, unknown>} args - the model arguments.
     * @param {{signal?: AbortSignal}} [exec] - the host execution context.
     * @returns {Promise<object>} the canonical result value.
     */
    async execute(args, exec) {
      assertKnownArguments(args, BASH_ARGUMENTS)
      if (args?.description !== undefined && typeof args.description !== 'string')
        throw new Error('invalid description: expected a string')
      const rawCommand = args?.command
      const rawScriptPath = args?.script_path
      for (const [name, value] of [['command', rawCommand], ['script_path', rawScriptPath]]) {
        if (value != null && typeof value !== 'string') {
          throw new Error(`invalid ${name}: expected a string`)
        }
      }
      // Some model/tool adapters fill optional strings with "" or null rather
      // than omitting them. Treat those as absent, not as a second executor.
      // Never ignore two real inputs: choosing one would silently discard intent.
      const command = typeof rawCommand === 'string' && rawCommand.trim() !== '' ? rawCommand : undefined
      const scriptPath = typeof rawScriptPath === 'string' && rawScriptPath.trim() !== '' ? rawScriptPath : undefined
      const hasCommand = command !== undefined
      const hasScriptPath = scriptPath !== undefined
      if (!hasCommand && !hasScriptPath) {
        if (typeof rawCommand === 'string')
          throw new Error('invalid command: expected a non-empty string; omit or leave script_path empty when using command')
        if (typeof rawScriptPath === 'string')
          throw new Error('invalid script_path: expected a non-empty string; omit or leave command empty when using script_path')
        throw new Error('invalid bash input: provide exactly one of command or script_path')
      }
      if (hasCommand && hasScriptPath) {
        throw new Error('invalid bash input: provide exactly one of command or script_path; for commands omit script_path or set it to "", not /dev/null')
      }
      const timeoutMs = args?.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS
      assertPositiveFinite('timeoutMs', timeoutMs)
      if (timeoutMs > MAX_BASH_TIMEOUT_MS) {
        throw new Error(`invalid timeoutMs: must be no greater than ${MAX_BASH_TIMEOUT_MS}, got ${timeoutMs}`)
      }
      const graceMs = args?.graceMs ?? DEFAULT_GRACE_MS
      assertPositiveFinite('graceMs', graceMs)
      const workdir = args?.workdir
      if (workdir !== undefined && typeof workdir !== 'string') {
        throw new Error('invalid workdir: expected a string')
      }

      // No subprocess re-check here: `publishShellTools` publishes this tool
      // only while `ctx.subprocess` is mounted, so a definition that exists at
      // all always has the one service it needs.

      // One deadline plus the caller's cancellation, fused into the signal the
      // subprocess service terminates its process range on.
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new Error(`command timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      const callerSignal = exec?.signal
      const onCallerAbort = () => controller.abort(callerSignal?.reason)
      if (callerSignal !== undefined) {
        if (callerSignal.aborted)
          onCallerAbort()
        else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
      }

      try {
        let handle
        try {
          const argv = hasCommand ? [file, '-c', command] : [file, scriptPath]
          const preparedArgv = prepareArgv ? await prepareArgv(argv, controller.signal) : argv
          handle = subprocess.spawn({
            argv: preparedArgv,
            cwd: workdir,
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: DEFAULT_MAX_OUTPUT_BYTES, spill: { maxBytes: DEFAULT_MAX_SPILL_BYTES } },
              stderr: { maxBytes: DEFAULT_MAX_OUTPUT_BYTES, spill: { maxBytes: DEFAULT_MAX_SPILL_BYTES } },
            },
            graceMs,
            signal: controller.signal,
            // The terminal overrides and nothing else: the subprocess service's
            // own scrub decides what else a child may inherit, and this plugin
            // never adds a credential-shaped name or a `DSH_*` fact to that set.
            env: { ...ENV_OVERRIDES, ...env },
          })
          const outcome = await handle.done
          // "Nothing to report" is an ABSENT key, not a null: the output schema
          // declares single types only (see BASH_OUTPUT_SCHEMA).
          return {
            ...outcome?.exitCode !== undefined && outcome?.exitCode !== null ? { exitCode: outcome.exitCode } : {},
            ...outcome?.signal !== undefined && outcome?.signal !== null ? { signal: outcome.signal } : {},
            timedOut,
            timeoutMs,
            stdout: settledStream(handle.collected?.stdout),
            stderr: settledStream(handle.collected?.stderr),
          }
        }
        catch (error) {
          return {
            error: formatBashSpawnError(error, file, source),
            timedOut,
            timeoutMs,
            stdout: { text: '', truncated: false },
            stderr: { text: '', truncated: false },
          }
        }
      }
      finally {
        clearTimeout(timer)
        callerSignal?.removeEventListener('abort', onCallerAbort)
      }
    },
  }
}

/**
 * The one remedy two rungs share: the machine's own bash is not a registry
 * artifact, so "fetch it from the registry" is not the advice it needs.
 */
const SYSTEM_BASH_SPAWN_REMEDY = 'The system bash this deployment selected is gone; restore the system Bash executable.'

/**
 * The remedy one ENOENT deserves, chosen by where the executable came from.
 *
 * All of these are "the file was there when the rung resolved and is gone now",
 * but they are restored by different actions: `bundled` by the profile's own
 * dependencies, `provisioned` by running the provisioner again, `config` by the
 * operator fixing the path they typed, and `path`/`well-known` by the machine's
 * own bash. The single sentence this replaced told all of them to repair the
 * profile installation, so most were sent somewhere that could not help.
 * @type {Readonly<Record<string, string>>}
 */
const BASH_SPAWN_REMEDY = Object.freeze({
  'bundled': 'The bundled bash left the runtime package after resolution; reinstall with optional dependencies enabled.',
  'config': 'The configured bashPath no longer exists; point bashPath at a real executable.',
  'path': SYSTEM_BASH_SPAWN_REMEDY,
  'well-known': SYSTEM_BASH_SPAWN_REMEDY,
})

/**
 * The remedy for a source this table has never seen (D8).
 *
 * `source` is a closed set today, but it is a string that reaches here from the
 * resolution: a future rung must degrade to a line that is still actionable
 * rather than to no advice at all, and it must not throw on the way.
 */
const DEFAULT_BASH_SPAWN_REMEDY = `${GENERIC_BASH_REMEDY}.`

/**
 * Convert an infrastructure spawn failure into a concise model-facing result.
 *
 * Only ENOENT is source-routed: it is the one failure that means "this exact
 * executable vanished", and what to do about it depends entirely on which rung
 * supplied it. Every other spawn failure keeps the plain message, because the
 * rung is not the interesting part of it.
 * @param {unknown} error - the failure `ctx.subprocess.spawn` raised.
 * @param {string} file - the executable the rung resolved.
 * @param {string} source - where that executable came from.
 * @returns {string} the model-facing error text.
 */
function formatBashSpawnError(error, file, source) {
  const code = typeof error?.code === 'string' ? ` (${error.code})` : ''
  if (error?.code === 'ENOENT') {
    const remedy = Object.hasOwn(BASH_SPAWN_REMEDY, source)
      ? BASH_SPAWN_REMEDY[source]
      : DEFAULT_BASH_SPAWN_REMEDY
    return `bash executable is unavailable${code}: ${file}. ${remedy}`
  }
  return `bash could not be started${code}: ${String(error?.message ?? error)}`
}

/**
 * Report one load-time shell problem without letting a hostile logger hide it.
 * @param {object} ctx - a Cordis context.
 * @param {string} message - the report.
 * @returns {void}
 */
function reportShellProblem(ctx, message) {
  const logger = ctx?.logger
  if (typeof logger?.warn === 'function') {
    logger.warn(message)
    return
  }
  if (typeof logger?.error === 'function') {
    logger.error(message)
    return
  }
  console.warn(message)
}

/**
 * Publish the tools that run on the plugin's own shells.
 *
 * Today that is exactly one tool — `ops_bash`, bound to the resolved bash — and
 * nothing else: pwsh needs no tool, because the host's `pwsh-sandbox` row runs
 * the plugin's own executable whenever the bundle override resolved one. A rung
 * that is unavailable publishes nothing and reports why through the context
 * logger; it never throws, because a deployment without bash must still load
 * this plugin.
 * @param {object} ctx - a Cordis context carrying the tool registry.
 * @param {import('./config.js').ResolvedConfig} config - the plugin configuration.
 * @param {{bash: ShellResolution, pwsh: ShellResolution}} shells - the resolution to publish for.
 * @returns {() => void} the disposer for every registration made here.
 */
export function publishShellTools(ctx, config, shells) {
  if (config?.publishBashTool === false)
    return () => {}
  const bash = shells?.bash
  if (bash === undefined || bash.available !== true || typeof bash.file !== 'string') {
    const reason = bash?.detail ?? 'the bash rung was not resolved'
    reportShellProblem(ctx, `dsh-ops: the plugin's own bash is unavailable (${reason}); `
    + `${BASH_TOOL_NAME} is not published.`)
    return () => {}
  }

  const registry = ctx?.get?.('tools')
  if (registry === undefined || typeof registry.register !== 'function') {
    reportShellProblem(ctx, `dsh-ops: no tool registry (ctx.tools) is mounted; `
    + `${BASH_TOOL_NAME} was not published.`)
    return () => {}
  }
  // Reaching the host service through `ctx.get` keeps this module free of any
  // `@deepseek-ai/*` value import while still running every command through the
  // harness's own credential scrub and process governance.
  //
  // This check gates the REGISTRATION, not just the call: without the
  // subprocess service the tool could be published and then fail on every
  // invocation, and a deployment whose ladder advertises rung two for a tool
  // that cannot run is worse than one that admits the rung is missing.
  const subprocess = ctx?.get?.('subprocess')
  if (subprocess === undefined || typeof subprocess.spawn !== 'function') {
    reportShellProblem(ctx, `dsh-ops: no subprocess service (ctx.subprocess) is mounted, so the `
    + `resolved bash (${bash.source}) cannot be run; ${BASH_TOOL_NAME} is not published.`)
    return () => {}
  }

  let dispose
  try {
    dispose = registry.register(bashToolDefinition({ file: bash.file, source: bash.source, subprocess }))
  }
  catch (error) {
    // A registry conflict (a foreign `ops_bash`) or a schema rejection is
    // reported and skipped: it must not fail plugin activation.
    reportShellProblem(ctx, `dsh-ops: ${BASH_TOOL_NAME} could not be registered `
    + `(${String(error?.message ?? error)}).`)
    return () => {}
  }
  if (typeof dispose !== 'function')
    return () => {}
  let disposed = false
  return () => {
    if (disposed)
      return
    disposed = true
    dispose()
  }
}
