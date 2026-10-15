import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import { ABSOLUTE_RUNTIME_PATH, DEFAULT_CONFIG, MAX_TOOL_CALL_TIMEOUT_MS } from '../constants'
import { CONFIGURATION_FIELDS } from './constants'

export const FIELD_SPECS: SettingsFieldSpec[] = CONFIGURATION_FIELDS.map(field => ({
  field,
  format: value => String(value ?? DEFAULT_CONFIG[field]),
  parse: (text) => {
    const fallback = DEFAULT_CONFIG[field]
    if (typeof fallback === 'boolean') {
      return text === 'true' || text === 'false'
        ? { kind: 'set', value: text === 'true' }
        : undefined
    }
    if (field === 'runtimeMode') {
      return text === 'local-first' || text === 'managed'
        ? { kind: 'set', value: text }
        : undefined
    }
    if (field === 'toolCallTimeoutMs') {
      const value = Number(text)
      return /^[1-9]\d*$/u.test(text) && Number.isSafeInteger(value) && value <= MAX_TOOL_CALL_TIMEOUT_MS
        ? { kind: 'set', value }
        : undefined
    }
    if (field !== 'extraGuidance' && !ABSOLUTE_RUNTIME_PATH.test(text))
      return undefined
    return { kind: 'set', value: text }
  },
}))
