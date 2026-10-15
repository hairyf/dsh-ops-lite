import type { OpsConfig } from '../types'
import { CONFIG_ROW_ID, OFFICIAL_TOOLS_DESCRIPTION, PACKAGE_NAME } from '../constants'

export const CONFIGURATION_SLOT = 'plugins.bundle.config'
export const CONFIGURATION_KEY = PACKAGE_NAME
export const CONFIGURATION_REGISTRANT = PACKAGE_NAME
export const CONFIGURATION_ENTRY_ID = CONFIG_ROW_ID
export const STYLE_TAG_ID = `${PACKAGE_NAME}/configuration.css`
export const CONFIGURATION_FIELD = 'disableOfficialTools' satisfies keyof OpsConfig

export const CONFIGURATION_MESSAGES = {
  unavailable: '宿主尚未提供此插件的配置；请确认插件已启用并已连接。',
  readOnly: '当前连接不可写，无法保存到宿主配置。',
  saveFailed: '设置未保存，请检查连接或并发修改后重试。',
} as const

export const TOGGLE_LABEL = '禁用官方基础工具'
export const TOGGLE_DESCRIPTION = OFFICIAL_TOOLS_DESCRIPTION

export const CLASSES = {
  root: 'dsh-ops-next-config',
  summary: 'dsh-ops-next-summary',
  row: 'dsh-ops-next-row',
  rowText: 'dsh-ops-next-row-text',
  rowTitle: 'dsh-ops-next-row-title',
  rowDescription: 'dsh-ops-next-row-description',
  status: 'dsh-ops-next-status',
} as const
