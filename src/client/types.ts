import type { SettingsFieldState, SettingsFormActions, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposedProps, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PACKAGE_NAME } from '../constants'
import type { OpsConfig } from '../types'
import type { CONFIGURATION_SLOT } from './constants'

export type BooleanConfigKey = {
  [K in keyof OpsConfig]: OpsConfig[K] extends boolean ? K : never
}[keyof OpsConfig]

export interface ToggleDefinition {
  field: BooleanConfigKey
  label: string
  description: string
}

export interface PathDefinition {
  field: 'bashPath' | 'pwshPath' | 'fastctxPath' | 'workerPath'
  label: string
  description: string
}

export interface ConfigurationState {
  shell: SettingsFormShell
  fields: Record<keyof OpsConfig, SettingsFieldState>
}

export interface ConfigurationInject {
  hooks: { configuration: HostObservable<ConfigurationState> }
  formActions: SettingsFormActions
}

export type ConfigurationProps = ComposedProps<
  typeof CONFIGURATION_SLOT,
  typeof PACKAGE_NAME,
  never,
  undefined,
  ConfigurationInject
>
