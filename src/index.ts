import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { OpsConfig, OpsConfigRef, RuntimeResolution } from './types'
import process from 'node:process'
import { Config } from './config'
import { OFFICIAL_TOOLS, PACKAGE_NAME } from './constants'
import { resolveNativeWorker, resolveRuntimes, upstreamModule } from './runtimes'

export { Config }
export const name = PACKAGE_NAME
export const inject = ['tools']

function disableOfficialTools(ctx: Context): void {
  const denied = new Set<string>(OFFICIAL_TOOLS)
  const lifts = new Map<Agent, Map<string, () => void>>()
  let updating = false
  const refresh = (): void => {
    if (updating)
      return
    updating = true
    try {
      for (const agent of ctx.get('agents')?.list() ?? []) {
        const owned = lifts.get(agent) ?? new Map<string, () => void>()
        lifts.set(agent, owned)
        for (const tool of ctx.tools.schemas(agent)) {
          if (!denied.has(tool.name) || owned.has(tool.name))
            continue
          try {
            owned.set(tool.name, agent.ctx.tools.restrict({ deny: [tool.name] }))
          }
          catch (error) {
            // ponytail: the SDK cannot hide agent-owned schemas; use its guard until a scoped hide API exists.
            if (!(error instanceof Error) || !error.message.startsWith('tools.restrict() names unknown global tool "'))
              throw error
          }
        }
      }
    }
    finally {
      updating = false
    }
  }
  ctx.on('agent/created', () => {
    refresh()
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const owned = lifts.get(agent)
    lifts.delete(agent)
    for (const lift of owned?.values() ?? [])
      lift()
  })
  ctx.on('tools/change', refresh)
  ctx.effect(() => ctx.tools.guard(exec => denied.has(exec.name) ? 'Official basic tools are disabled by dsh-ops-next. Use the enabled ops_* capabilities or change the plugin setting.' : undefined), 'dsh-ops-next: official tool execution denial')
  ctx.effect(() => () => {
    updating = true
    for (const owned of lifts.values()) {
      for (const lift of owned.values())
        lift()
    }
    lifts.clear()
  }, 'dsh-ops-next: restore official tool visibility')
  refresh()
}

async function mount(ctx: Context, config: OpsConfig): Promise<void> {
  const [runtimes, worker] = await Promise.all([resolveRuntimes(config), resolveNativeWorker(config)])
  const status = {
    components: { shell: config.enableShell, file: config.enableFile, background: config.enableBackground, ptc: config.enablePtc },
    runtimeMode: config.runtimeMode,
    allowLocalRuntimes: config.allowLocalRuntimes,
    disableOfficialTools: config.disableOfficialTools,
    runtimes: { ...runtimes, worker },
  }
  ctx.effect(() => ctx.tools.register({
    name: 'ops_status',
    description: 'Report enabled Ops components, runtime provenance, compatibility failures and explicit provisioning instructions. Never downloads or installs software.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length)
        throw new Error('ops_status accepts an empty object only.')
      return status
    },
    isConcurrencySafe: () => true,
  }), 'dsh-ops-next: diagnostics')
  if (config.disableOfficialTools)
    disableOfficialTools(ctx)

  const ensure = (runtime: RuntimeResolution, component: string): boolean => {
    if (runtime.available)
      return true
    const message = `${component}: ${runtime.detail}`
    if (config.required)
      throw new Error(message)
    ctx.logger.warn(message)
    return false
  }
  const upstream = await import(upstreamModule('index.js'))
  const common = {
    required: config.required,
    promptPolicy: config.promptPolicy,
    ...(config.extraGuidance ? { extraGuidance: config.extraGuidance } : {}),
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    enableShellTools: config.enableShellTools,
    allowSystemShellFallback: false,
    configUpdateVersion: 1,
    ...(runtimes.bash.file ? { bashPath: runtimes.bash.file } : {}),
  }
  if (config.enableShell) {
    if (config.publishBashTool)
      ensure(runtimes.bash, 'Bash')
    if (process.platform === 'win32')
      ensure(runtimes.pwsh, 'PowerShell 7')
    upstream.applyComponent(ctx, { ...common, publishBashTool: config.publishBashTool && runtimes.bash.available }, 'shell', { shells: runtimes })
  }
  if (config.enableFile && ensure(worker, 'Native file tools'))
    upstream.applyComponent(ctx, { ...common, binaryPath: worker.file }, 'file')
  if (config.enableBackground && config.enableShellTools && ensure(runtimes.fastctx, 'Background jobs') && ensure(runtimes.bash, 'Background Bash'))
    upstream.applyComponent(ctx, { ...common, binaryPath: runtimes.fastctx.file }, 'background')
  if (config.enablePtc && ensure(worker, 'PTC')) {
    const ptc = await import(upstreamModule('ptc/index.js'))
    ptc.apply(ctx, { binaryPath: worker.file, required: config.required })
  }
}

/** Rebuild only our owned capability fiber after one atomic settings commit. */
export async function apply(ctx: Context, config: OpsConfigRef): Promise<void> {
  let current: Fiber | undefined
  let stopped = false
  let chain = Promise.resolve()
  const reconcile = (): Promise<void> => {
    const snapshot = { ...config.get() }
    chain = chain.catch(() => {}).then(async () => {
      await current?.dispose()
      current = undefined
      if (stopped)
        return
      current = ctx.plugin(child => mount(child, snapshot))
      await current.await()
    })
    return chain
  }
  ctx.on('loader/volatile-update', () => reconcile().catch(error => ctx.logger.error(error)))
  ctx.effect(() => async () => {
    stopped = true
    await chain.catch(() => {})
    await current?.dispose()
  }, 'dsh-ops-next: component lifecycle')
  await reconcile()
}
