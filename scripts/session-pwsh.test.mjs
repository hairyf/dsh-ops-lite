import process from 'node:process'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Schema from '@deepseek-ai/schemastery'
import { afterEach, expect, it, vi } from 'vitest'
import { applyComponent } from '../src/ops/index.js'
import { renderToolingPolicy } from '../src/ops/policy.js'
import { mountBundledPwsh } from '../src/ops/session-pwsh.js'
import * as shellRuntime from '../src/ops/shells.js'

const bundled = 'C:/bundled/PowerShell/7/pwsh.exe'
const original = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const baseline = { id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox' }
const desktop = { id: 'desktop-windows-pwsh-sandbox', name: 'dsh-plugin-desktop/windows-pwsh-sandbox' }

// Use the installed Loader/Fiber and live-reference schema, not a fake config waterfall.
async function runtime(rows) {
  const ctx = new Context()
  const writes = vi.fn()
  await ctx.plugin(Loader).await()
  const loader = ctx.get('loader')
  loader.write = writes
  const mounts = vi.fn()
  const executor = {
    Config: Schema.object({ pwshPath: Schema.string().volatile(), timeoutMs: Schema.number().default(120000).volatile() }),
    apply(ctx, config) {
      mounts(ctx.fiber.entry.options.id)
      ctx.provide('shell', {
        get pwshPath() { return config.pwshPath.get() },
      })
      // A nested plugin inherits the same entry, but must not receive executor config.
      ctx.plugin((_ctx, nested) => expect(nested).toEqual({ child: true }), { child: true })
    },
  }
  loader.import = () => executor
  await loader.root.update(rows.map(row => ({ ...row, config: { pwshPath: original, timeoutMs: 120000 } })))
  await loader.await()
  writes.mockClear()
  return { ctx, loader, writes, mounts }
}

afterEach(() => vi.restoreAllMocks())

it.each([baseline, desktop])('takes over only the supported $id executor and restores the latest raw config', async (identity) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const { ctx, loader, writes, mounts } = await runtime([identity])
  const entry = loader.resolve(identity.id)
  const raw = entry.options.config
  let active
  const ops = ctx.plugin((ctx) => {
    active = mountBundledPwsh(ctx, { pwsh: { available: true, file: bundled } })
  })
  try {
    await ops.await()
    await loader.await()
    expect(ctx.get('shell').pwshPath).toBe(bundled)
    expect(entry.options.config).toBe(raw)
    expect(raw.pwshPath).toBe(original)
    expect(writes).not.toHaveBeenCalled()
    expect(active()).toBe(true)

    const appliedMounts = mounts.mock.calls.length
    await entry.update({ config: { ...raw, pwshPath: 'C:/user/new-pwsh.exe', timeoutMs: 45000 } })
    await loader.await()
    expect(ctx.get('shell').pwshPath).toBe(bundled)
    expect(entry.fiber.config.timeoutMs.get()).toBe(45000)
    expect(mounts).toHaveBeenCalledTimes(appliedMounts)
    expect(writes).not.toHaveBeenCalled()
    await ops.dispose()
    await loader.await()
    expect(active()).toBe(false)
    expect(ctx.get('shell').pwshPath).toBe('C:/user/new-pwsh.exe')
    expect(entry.options.config.pwshPath).toBe('C:/user/new-pwsh.exe')
    expect(writes).not.toHaveBeenCalled()
    await ops.dispose()
  }
  finally {
    await ctx.fiber.dispose()
  }
})

it('ignores disabled and lookalike identities, and overlays a supported late executor without update loops', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  for (const row of [
    { id: 'lookalike-pwsh-sandbox', name: desktop.name },
    { id: desktop.id, name: '@custom/pwsh-sandbox' },
    { id: baseline.id, name: desktop.name },
  ]) {
    const { ctx, loader, mounts, writes } = await runtime([row])
    try {
      const ops = ctx.plugin((ctx) => {
        mountBundledPwsh(ctx, { pwsh: { available: true, file: bundled } })
      })
      await ops.await()
      await loader.await()
      expect(ctx.get('shell').pwshPath).toBe(original)
      expect(mounts).toHaveBeenCalledTimes(1)
      expect(writes).not.toHaveBeenCalled()
    }
    finally {
      await ctx.fiber.dispose()
    }
  }
  const { ctx, loader, mounts, writes } = await runtime([
    { ...baseline, disabled: true },
    { ...desktop, disabled: true },
  ])
  let active
  const ops = ctx.plugin((ctx) => {
    active = mountBundledPwsh(ctx, { pwsh: { available: true, file: bundled } })
  })
  try {
    await ops.await()
    await loader.await()
    expect(ctx.get('shell')).toBeUndefined()
    expect(active()).toBe(false)
    expect(mounts).not.toHaveBeenCalled()
    const entry = loader.resolve(desktop.id)
    await entry.update({ disabled: false })
    await loader.await()
    expect(ctx.get('shell').pwshPath).toBe(bundled)
    expect(active()).toBe(true)
    const count = mounts.mock.calls.length
    await entry.update({ config: { ...entry.options.config } })
    await loader.await()
    expect(mounts).toHaveBeenCalledTimes(count)
    expect(writes).not.toHaveBeenCalled()
    await ops.dispose()
    await loader.await()
    expect(ctx.get('shell').pwshPath).toBe(original)
  }
  finally {
    await ctx.fiber.dispose()
  }
})

it('does not claim PowerShell 7 merely because its executable exists', async () => {
  let render
  const context = {
    inject(services, callback) {
      if (services.includes('systemPrompt'))
        callback(context)
    },
    effect(create) { create() },
    systemPrompt: {
      section(section) {
        render = section.text
        return () => {}
      },
    },
    get: () => ({ schemas: () => [{ name: 'ops_bash' }, { name: 'pwsh' }] }),
  }
  vi.spyOn(shellRuntime, 'resolveShells').mockReturnValue({
    bash: { available: true, file: process.execPath },
    pwsh: { available: true, file: bundled },
  })
  // Both executable resolutions succeeded, but no executor/Loader was mounted.
  applyComponent(context, {}, 'shell')
  const text = render({ agent: {} })
  expect(text).toContain('pwsh (host PowerShell)')
  expect(text).not.toContain('PowerShell 7')
  expect(renderToolingPolicy({ published: ['ops_bash'], pwsh7: false })).not.toContain('PowerShell 7')
  expect(renderToolingPolicy({ published: ['ops_bash', 'pwsh'], pwsh7: true })).toContain('bundled PowerShell 7 via host')
})
