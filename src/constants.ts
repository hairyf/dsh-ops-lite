import type { OpsConfig } from './types'

export const PACKAGE_NAME = 'dsh-ops-next'
export const CONFIG_ROW_ID = PACKAGE_NAME
export const OFFICIAL_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent'] as const
export const DEFAULT_CONFIG = { disableOfficialTools: false } as const satisfies OpsConfig
