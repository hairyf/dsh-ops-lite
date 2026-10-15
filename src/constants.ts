import type { OpsConfig } from './types'

export const PACKAGE_NAME = 'dsh-ops-lite'
export const CONFIG_ROW_ID = 'dsh-ops-next-file'
export const OFFICIAL_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent'] as const
export const OFFICIAL_TOOL_SECTIONS = ['tool:read', 'tool:write', 'tool:edit', 'tool:glob', 'tool:grep', 'tool:bash', 'tool:pwsh'] as const
export const OFFICIAL_TOOLS_DESCRIPTION = '开启后禁用官方基础文件与 Shell 工具，保留 read_image，不改变权限或沙箱。'
export const DEFAULT_CONFIG = { disableOfficialTools: true } as const satisfies OpsConfig
