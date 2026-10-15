import { Buffer } from 'node:buffer'
import { randomUUID, timingSafeEqual } from 'node:crypto'

// Test-only driver: real Agents and the public registry pipeline, without an LLM.
export const name = 'dsh-ops-lite-e2e-api'
export const inject = ['webServer', 'agents', 'agentPresets', 'tools', 'permissionPresets', 'systemPrompt']

export function apply(ctx, config) {
  const handles = new Map()
  const pending = new Map()
  const secret = Buffer.from(config.token)
  let disposed = false
  const agentFor = async (scope) => {
    if (!['native', 'ptc', 'inherited', 'confined'].includes(scope))
      throw new Error('Invalid test scope')
    if (disposed)
      throw new Error('Test API is disposed')
    if (!pending.has(scope)) {
      pending.set(scope, ctx.agents.create({
        sessionId: `session-${randomUUID()}`,
        meta: { cwd: config.workspace },
        setup: scope === 'inherited' ? undefined : scoped => ctx.agentPresets.mount(scoped, scope === 'ptc' ? 'ptc' : 'standard').then(() => {}),
      }).then(async (handle) => {
        if (disposed) {
          await handle.dispose()
          throw new Error('Test API was disposed during Agent creation')
        }
        handles.set(scope, handle)
        ctx.permissionPresets.set(handle.agent.session, scope === 'confined' ? 'workspace-write' : 'danger-full-access')
        return handle.agent
      }))
    }
    return pending.get(scope)
  }
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const handler = async (req, res) => {
    const authorization = Buffer.from(req.headers.authorization ?? '')
    if (authorization.length !== secret.length || !timingSafeEqual(authorization, secret))
      return reply(res, 401, { error: 'Unauthorized' })
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${ctx.webServer.port}`)
      return reply(res, 403, { error: 'Cross-origin request' })
    const url = new URL(req.url, `http://127.0.0.1:${ctx.webServer.port}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('E2E call deadline exceeded')), 60_000)
    const abort = () => {
      if (!res.writableEnded)
        controller.abort(new Error('E2E client disconnected'))
    }
    req.once('aborted', abort)
    res.once('close', abort)
    try {
      if (url.pathname === '/__e2e/schemas' && req.method === 'GET') {
        const agent = await agentFor(url.searchParams.get('scope') ?? 'native')
        const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent, signal: controller.signal })
        return reply(res, 200, {
          schemas: ctx.tools.schemas(agent),
          wireTools: assembly.tools.map(tool => tool.name),
          sections: assembly.sections.map(section => ({ name: section.name, text: section.text })),
        })
      }
      if (url.pathname !== '/__e2e/call' || req.method !== 'POST')
        return reply(res, 405, { error: 'Method not allowed' })
      let text = ''
      for await (const chunk of req) {
        text += chunk.toString()
        if (Buffer.byteLength(text) > 16_384)
          return reply(res, 413, { error: 'Body too large' })
      }
      const body = JSON.parse(text)
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof body.name !== 'string' || !/^(?:ops_\w+|read|write|edit|glob|grep|bash|pwsh|run_code)$/.test(body.name)
        || !body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) {
        return reply(res, 400, { error: 'Invalid call' })
      }
      const agent = await agentFor(body.scope ?? 'native')
      const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
        callId: randomUUID(),
        name: body.name,
        arguments: body.arguments,
        agent,
        signal: controller.signal,
      }))
      return reply(res, 200, result)
    }
    catch (error) {
      if (!res.writableEnded)
        reply(res, 500, { error: String(error?.stack ?? error) })
    }
    finally {
      clearTimeout(timer)
      req.off('aborted', abort)
      res.off('close', abort)
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/__e2e', handler }))
  ctx.effect(() => async () => {
    disposed = true
    await Promise.allSettled([...handles.values()].map(handle => handle.dispose()))
    handles.clear()
  })
}
