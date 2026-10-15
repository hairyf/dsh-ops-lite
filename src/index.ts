import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { OpsConfigRef } from './types'
import { renderToolsSdk, renderToolsSdkPy } from '@deepseek-ai/dsh-tools'
import { Config } from './config'
import { OFFICIAL_TOOL_SECTIONS, OFFICIAL_TOOLS, PACKAGE_NAME } from './constants'
import { applyComponent } from './ops/index.js'

export { Config }
export const name = PACKAGE_NAME
export const inject = ['tools', 'sandboxPolicy', 'subprocess']

function disableOfficialTools(ctx: Context): void {
  const denied = new Set<string>(OFFICIAL_TOOLS)
  const hiddenSections = new Set<string>(OFFICIAL_TOOL_SECTIONS)
  const lifts = new Map<Agent, Map<string, () => void>>()
  ctx.inject(['systemPrompt'], (branch) => {
    branch.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembly = await next()
      if (!context.agent)
        return assembly
      let sdk: string | undefined
      if (assembly.sections.some(section => section.name === 'tools:sdk' && section.text.length > 0)) {
        const schemas: Parameters<typeof renderToolsSdk>[0] = []
        for (const schema of ctx.tools.schemas(context.agent)) {
          const definition = ctx.tools.get(schema.name, context.agent)
          if (definition && schema.name !== 'run_code' && !denied.has(schema.name))
            schemas.push({ ...schema, output: definition.output.schema })
        }
        const language = ctx.get('ptcRuntime')?.language
        if (language === 'typescript')
          sdk = renderToolsSdk(schemas)
        else if (language === 'python')
          sdk = renderToolsSdkPy(schemas)
        else
          throw new Error(`Cannot filter the official tools from PTC SDK language ${String(language)}`)
      }
      return {
        ...assembly,
        tools: assembly.tools.filter(tool => !denied.has(tool.name)),
        sections: assembly.sections.filter(section => !hiddenSections.has(section.name))
          .map(section => section.name === 'tools:sdk' && sdk !== undefined ? { ...section, text: sdk, interpolate: false } : section),
      }
    })
  })
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
  ctx.effect(() => ctx.tools.guard(exec => denied.has(exec.name) ? 'Official basic tools are disabled by dsh-ops-lite. Use the enabled ops_* capabilities or change the plugin setting.' : undefined), 'dsh-ops-lite: official tool execution denial')
  ctx.effect(() => () => {
    updating = true
    for (const owned of lifts.values()) {
      for (const lift of owned.values())
        lift()
    }
    lifts.clear()
  }, 'dsh-ops-lite: restore official tool visibility')
  refresh()
}

/** The bundle mounts each capability from its independently owned loader row. */
export async function apply(ctx: Context, config: OpsConfigRef): Promise<void> {
  applyComponent(ctx, { required: true }, 'file')
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
  }, 'dsh-ops-lite: official tool policy')
  await reconcile()
}
