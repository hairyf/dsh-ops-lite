import type { SettingsFieldSpec, SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OpsConfig } from '../types'
import { CONFIG_ROW_ID, DEFAULT_CONFIG, PACKAGE_NAME } from '../constants'

export const CONFIGURATION_SLOT = 'plugins.bundle.config'
export const CONFIGURATION_KEY = PACKAGE_NAME
export const CONFIGURATION_REGISTRANT = PACKAGE_NAME
export const CONFIGURATION_ENTRY_ID = CONFIG_ROW_ID
export const STYLE_TAG_ID = `${PACKAGE_NAME}/configuration.css`
export const CONFIGURATION_FIELD = 'disableOfficialTools' satisfies keyof OpsConfig

export const FIELD_SPECS: SettingsFieldSpec[] = [{
  field: CONFIGURATION_FIELD,
  format: value => String(value ?? DEFAULT_CONFIG.disableOfficialTools),
  parse: text => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined,
}]

export const FORM_LABELS = {
  unavailable: '宿主尚未提供此插件的配置；请确认插件已启用并已连接。',
  readOnly: '当前连接不可写，无法保存到宿主配置。',
  saveFailed: '宿主未接受修改。草稿已保留；请检查权限或并发修改后重试。',
  save: '保存设置',
  saving: '正在保存…',
} satisfies SettingsFormLabels

export const TOGGLE_LABEL = '禁用官方基础工具'
export const TOGGLE_DESCRIPTION = '默认关闭；开启后拒绝官方基础文件与 Shell 工具调用，保留 read_image，不改变权限或沙箱。'
export const SCHEMA_NOTICE = '公开 SDK 无法隐藏 agent 自己注册的工具 schema，它们可能仍然可见，但调用会被 guard 拒绝；关闭开关后恢复。'

export const CLASSES = {
  root: 'dsh-ops-next-config',
  summary: 'dsh-ops-next-summary',
  help: 'dsh-ops-next-help',
  row: 'dsh-ops-next-row',
  rowText: 'dsh-ops-next-row-text',
  rowTitle: 'dsh-ops-next-row-title',
  rowDescription: 'dsh-ops-next-row-description',
  notice: 'dsh-ops-next-notice',
} as const
