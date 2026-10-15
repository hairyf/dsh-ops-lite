import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { PACKAGE_NAME } from '../constants'
import type { OpsConfig } from '../types'
import type { CONFIGURATION_SLOT } from './constants'

export interface ConfigurationInject {
  configScope: ConfigForm<OpsConfig>
}

export type ConfigurationProps = ComposedProps<
  typeof CONFIGURATION_SLOT,
  typeof PACKAGE_NAME,
  never,
  undefined,
  ConfigurationInject
>
