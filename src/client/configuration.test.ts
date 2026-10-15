import { describe, expect, it } from 'vitest'
import { Config } from '../config'
import { DEFAULT_CONFIG, OFFICIAL_TOOLS } from '../constants'
import { CONFIGURATION_FIELD, FIELD_SPECS } from './constants'

describe('configuration contract', () => {
  it('exposes only the default-off official tool switch', () => {
    expect(DEFAULT_CONFIG).toEqual({ disableOfficialTools: false })
    expect(Config().get()).toEqual(DEFAULT_CONFIG)
    expect(FIELD_SPECS.map(spec => spec.field)).toEqual([CONFIGURATION_FIELD])
    expect(FIELD_SPECS[0].format(undefined)).toBe('false')
    expect(OFFICIAL_TOOLS).not.toContain('read_image')
    expect(OFFICIAL_TOOLS.every(name => !name.startsWith('ops_'))).toBe(true)
    for (const value of [true, false]) {
      expect(FIELD_SPECS[0].format(value)).toBe(String(value))
      expect(FIELD_SPECS[0].parse(String(value))).toEqual({ kind: 'set', value })
      expect(Config({ disableOfficialTools: value }).get()).toEqual({ disableOfficialTools: value })
    }
  })

  it('rejects non-boolean values at the draft and Host schema boundaries', () => {
    for (const text of ['', 'yes', '1', '0', 'TRUE', ' false ', 'null'])
      expect(FIELD_SPECS[0].parse(text)).toBeUndefined()
    for (const value of ['true', 'false', 1, 0, [], {}])
      expect(() => Config(JSON.parse(JSON.stringify({ disableOfficialTools: value })))).toThrow()
    // Schemastery treats null as an absent value; it must resolve to the safe default.
    expect(Config(JSON.parse('{"disableOfficialTools":null}')).get()).toEqual(DEFAULT_CONFIG)
  })
})
