import type { Volatile } from '@deepseek-ai/cordis'

export interface OpsConfig {
  disableOfficialTools: boolean
}

export type OpsConfigRef = Volatile<OpsConfig>
