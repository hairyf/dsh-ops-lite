import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { OpsConfigRef } from './types'
import process from 'node:process'
import { Config } from './config'
import { OFFICIAL_TOOLS, PACKAGE_NAME } from './constants'
import { resolveConfig } from './ops/config.js'
import { applyComponent } from './ops/index.js'
import { apply as applyPtc } from './ops/ptc/index.js'
import { resolveShells } from './ops/shells.js'

export { Config }
export const name = PACKAGE_NAME
export const inject = ['tools', 'sandboxPolicy', 'subprocess']

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

/** Mount the complete fork; missing shipped runtimes are an installation error, not a feature toggle. */
function mount(ctx: Context): void {
  const common = { required: true, allowSystemShellFallback: process.platform !== 'win32' }
  const shells = resolveShells(resolveConfig(common))
  if (!shells.bash.available)
    throw new Error(`dsh-ops-next: Bash unavailable: ${shells.bash.detail}`)
  const config = { ...common, bashPath: shells.bash.file }
  applyComponent(ctx, config, 'shell')
  applyComponent(ctx, config, 'file')
  applyComponent(ctx, config, 'background')
  applyPtc(ctx, { required: true })
}

/** Changing the one optional policy must not unload the working Ops runtimes. */
export async function apply(ctx: Context, config: OpsConfigRef): Promise<void> {
  mount(ctx)
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
      if (snapshot.disableOfficialTools) {
        current = ctx.plugin(disableOfficialTools)
        await current.await()
      }
    })
    return chain
  }
  ctx.on('loader/volatile-update', () => reconcile().catch(error => ctx.logger.error(error)))
  ctx.effect(() => async () => {
    stopped = true
    await chain.catch(() => {})
    await current?.dispose()
  }, 'dsh-ops-next: official tool policy')
  await reconcile()
}
