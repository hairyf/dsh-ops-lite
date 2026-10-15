import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactElement } from 'react'
import type { OpsConfig } from '../types'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../config'
import { CONFIG_ROW_ID, DEFAULT_CONFIG, OFFICIAL_TOOLS } from '../constants'
import { ConfigurationPage } from './configuration-page'
import { CONFIGURATION_ENTRY_ID, CONFIGURATION_FIELD, CONFIGURATION_MESSAGES, TOGGLE_DESCRIPTION } from './constants'

const hooks = vi.hoisted(() => ({
  values: [] as boolean[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
}))
vi.mock('react', () => ({
  useEffect: () => {},
  useRef: (value: unknown) => hooks.refs[hooks.refIndex++] ??= { current: value },
  useState: (initial: boolean) => {
    const index = hooks.stateIndex++
    hooks.values[index] ??= initial
    return [hooks.values[index], (value: boolean) => {
      hooks.values[index] = value
    }]
  },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Switch: () => null }))

function render(scope: ConfigForm<OpsConfig>) {
  hooks.stateIndex = 0
  hooks.refIndex = 0
  const page = ConfigurationPage({
    view: 'page',
    configScope: scope,
    renderSlot: {},
    renderFactorySlot: () => { throw new Error('Settings page must not render factories.') },
    usePanelInfo: () => { throw new Error('Settings page must not depend on panel state.') },
  })
  const children = (page.props as { children: ReactElement[] }).children
  const toggle = (children[0].props as { children: ReactElement[] }).children[1]
  return {
    toggle: toggle.props as { checked: boolean, disabled: boolean, onChange: (value: boolean) => Promise<void> },
    error: children[2],
  }
}

beforeEach(() => {
  hooks.values = []
  hooks.refs = []
})

describe('configuration contract', () => {
  it('keeps the file row package-root discoverable so the settings Switch is mounted', () => {
    const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(patch.match(/\bid: /g)).toHaveLength(4)
    expect(patch.replaceAll('\r\n', '\n')).toContain(`- id: ${CONFIG_ROW_ID}\n      name: ${manifest.name}\n`)
    expect(manifest.exports['./locale/*.json']).toBe(manifest.exports['./file/locale/*.json'])
    expect(manifest.exports['./icon']).toBe(manifest.exports['./file/icon'])
  })

  it('defaults to enabled in the file-row namespace and preserves explicit false', () => {
    expect(DEFAULT_CONFIG).toEqual({ disableOfficialTools: true })
    expect(Config().get()).toEqual(DEFAULT_CONFIG)
    expect(CONFIG_ROW_ID).toBe('dsh-ops-next-file')
    expect(CONFIGURATION_ENTRY_ID).toBe(CONFIG_ROW_ID)
    expect(TOGGLE_DESCRIPTION).toBe('开启后禁用官方基础文件与 Shell 工具，保留 read_image，不改变权限或沙箱。')
    expect(OFFICIAL_TOOLS).not.toContain('read_image')
    expect(OFFICIAL_TOOLS.every(name => !name.startsWith('ops_'))).toBe(true)
    for (const value of [true, false])
      expect(Config({ disableOfficialTools: value }).get()).toEqual({ disableOfficialTools: value })
  })

  it('rejects non-booleans at the Host schema boundary', () => {
    for (const value of ['true', 'false', 1, 0, [], {}])
      expect(() => Config(JSON.parse(JSON.stringify({ disableOfficialTools: value })))).toThrow()
    // Schemastery treats null as absent and resolves the same default as the UI.
    expect(Config(JSON.parse('{"disableOfficialTools":null}')).get()).toEqual(DEFAULT_CONFIG)
  })

  it('autosaves one revision-fenced change, never showing a refused value as saved', async () => {
    let snapshot: ConfigFormSnapshot<OpsConfig> = {
      status: 'ready',
      value: undefined,
      base: {},
      user: {},
      revision: 7,
      writable: true,
      mode: 'host',
    }
    const pending = Promise.withResolvers<boolean>()
    const scope: ConfigForm<OpsConfig> = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate: vi.fn(() => pending.promise),
      set: vi.fn(async () => false),
      unset: vi.fn(async () => false),
    }
    const initial = render(scope)
    expect(initial.toggle.checked).toBe(true)
    const saving = initial.toggle.onChange(false)
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: [CONFIGURATION_FIELD], value: false }], 7)
    expect(render(scope).toggle).toMatchObject({ checked: true, disabled: true })
    await initial.toggle.onChange(true)
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    snapshot = { ...snapshot, value: { disableOfficialTools: false }, revision: 8 }
    pending.resolve(true)
    await saving
    expect(render(scope).toggle).toMatchObject({ checked: false, disabled: false })

    vi.mocked(scope.mutate).mockResolvedValue(false)
    await render(scope).toggle.onChange(true)
    expect(scope.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: [CONFIGURATION_FIELD], value: true }], 8)
    expect(render(scope).toggle).toMatchObject({ checked: false, disabled: false })
    expect(render(scope).error).toMatchObject({ props: { role: 'alert', children: CONFIGURATION_MESSAGES.saveFailed } })

    vi.mocked(scope.mutate).mockRejectedValue(new Error('transport failed'))
    await render(scope).toggle.onChange(true)
    expect(render(scope).toggle.checked).toBe(false)
    expect(render(scope).error).toMatchObject({ props: { role: 'alert', children: CONFIGURATION_MESSAGES.saveFailed } })
    for (const blocked of [{ writable: false }, { mode: 'memory' as const }, { status: 'unavailable' as const }]) {
      const prior = snapshot
      snapshot = { ...snapshot, ...blocked }
      const attempts = vi.mocked(scope.mutate).mock.calls.length
      expect(render(scope).toggle.disabled).toBe(true)
      await render(scope).toggle.onChange(true)
      expect(scope.mutate).toHaveBeenCalledTimes(attempts)
      snapshot = prior
    }
  })
})
