import { describe, expect, it } from 'vitest'
import { Config } from '../config'
import { ABSOLUTE_RUNTIME_PATH, DEFAULT_CONFIG, MAX_TOOL_CALL_TIMEOUT_MS, OFFICIAL_TOOLS } from '../constants'
import { FIELD_SPECS } from './fields'

function parse(field: string, text: string) {
  return FIELD_SPECS.find(spec => spec.field === field)?.parse(text)
}

describe('configuration contract', () => {
  it('shares all seventeen safe defaults with the Host and CLI', () => {
    expect(Config().get()).toEqual(DEFAULT_CONFIG)
    expect(FIELD_SPECS.map(spec => spec.field)).toEqual(Object.keys(DEFAULT_CONFIG))
    expect(FIELD_SPECS).toHaveLength(17)
    expect(OFFICIAL_TOOLS.every(name => !name.startsWith('ops_'))).toBe(true)
    expect(Config({ enableBackground: true, allowLocalRuntimes: true }).get()).toMatchObject({ enableBackground: true, allowLocalRuntimes: true })
  })

  it('blocks relative or unsafe runtime paths at both the draft and Host schema boundary', () => {
    for (const value of ['', '/usr/bin/bash', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', '\\\\server\\share\\bash.exe']) {
      expect(ABSOLUTE_RUNTIME_PATH.test(value)).toBe(true)
      expect(parse('bashPath', value)).toEqual({ kind: 'set', value })
      expect(Config({ bashPath: value }).get().bashPath).toBe(value)
    }
    for (const value of ['bash', './bash', 'C:bash.exe', '\\bash.exe', '\\\\server', '/bin/bash\n', '/bin/\0bash']) {
      expect(ABSOLUTE_RUNTIME_PATH.test(value)).toBe(false)
      expect(parse('bashPath', value)).toBeUndefined()
      expect(() => Config({ bashPath: value })).toThrow()
    }
  })

  it('accepts only bounded integer deadlines, explicit authorization and supported modes', () => {
    for (const value of [1, DEFAULT_CONFIG.toolCallTimeoutMs, MAX_TOOL_CALL_TIMEOUT_MS]) {
      expect(parse('toolCallTimeoutMs', String(value))).toEqual({ kind: 'set', value })
      expect(Config({ toolCallTimeoutMs: value }).get().toolCallTimeoutMs).toBe(value)
    }
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '2147483648', ''])
      expect(parse('toolCallTimeoutMs', value)).toBeUndefined()
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TOOL_CALL_TIMEOUT_MS + 1])
      expect(() => Config({ toolCallTimeoutMs: value })).toThrow()
    expect(parse('allowLocalRuntimes', 'true')).toEqual({ kind: 'set', value: true })
    expect(parse('allowLocalRuntimes', 'yes')).toBeUndefined()
    expect(parse('runtimeMode', 'managed')).toEqual({ kind: 'set', value: 'managed' })
    expect(parse('runtimeMode', 'fallback')).toBeUndefined()
    expect(() => Config(JSON.parse('{"runtimeMode":"fallback"}'))).toThrow()
    expect(parse('extraGuidance', '保留空格\n及说明')).toEqual({ kind: 'set', value: '保留空格\n及说明' })
  })
})
