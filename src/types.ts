import type { Volatile } from '@deepseek-ai/cordis'

export type RuntimeMode = 'local-first' | 'managed'
export type RuntimeKind = 'bash' | 'pwsh' | 'fastctx'

export interface OpsConfig {
  enableShell: boolean
  enableFile: boolean
  enableBackground: boolean
  enablePtc: boolean
  disableOfficialTools: boolean
  runtimeMode: RuntimeMode
  allowLocalRuntimes: boolean
  bashPath: string
  pwshPath: string
  fastctxPath: string
  workerPath: string
  promptPolicy: boolean
  publishBashTool: boolean
  enableShellTools: boolean
  required: boolean
  toolCallTimeoutMs: number
  extraGuidance: string
}

export type OpsConfigRef = Volatile<OpsConfig>

export interface RuntimeAttempt {
  file: string
  source: string
  detail: string
}

export interface RuntimeResolution {
  available: boolean
  file?: string
  source: string
  version?: string
  detail: string
  tried: RuntimeAttempt[]
}

export interface RuntimeSet {
  bash: RuntimeResolution
  pwsh: RuntimeResolution
  fastctx: RuntimeResolution
}
