import type { OpsConfig } from './types'

export const PACKAGE_NAME = 'dsh-ops-next'
export const CONFIG_ROW_ID = PACKAGE_NAME
export const OFFICIAL_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent'] as const
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 300_000
export const MAX_TOOL_CALL_TIMEOUT_MS = 2_147_483_647

// Accept an empty selection, POSIX absolute paths, drive paths and complete UNC paths.
// The Host still owns current-platform, existence, executable and trust checks.
export const ABSOLUTE_RUNTIME_PATH = /^(?:(?:\/|[a-z]:[\\/])[^\0\r\n]*|\\\\[^\\/\0\r\n]+[\\/][^\\/\0\r\n]+(?:[\\/][^\0\r\n]*)?)?$/iu

export const DEFAULT_CONFIG = {
  enableShell: true,
  enableFile: true,
  enableBackground: false,
  enablePtc: false,
  disableOfficialTools: false,
  runtimeMode: 'local-first',
  allowLocalRuntimes: false,
  bashPath: '',
  pwshPath: '',
  fastctxPath: '',
  workerPath: '',
  promptPolicy: true,
  publishBashTool: true,
  enableShellTools: true,
  required: false,
  toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
  extraGuidance: '',
} as const satisfies OpsConfig
