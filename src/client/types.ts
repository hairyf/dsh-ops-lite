import type { SettingsFieldState, SettingsFormActions, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposedProps, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PACKAGE_NAME } from '../constants'
import type { CONFIGURATION_SLOT } from './constants'

export interface ConfigurationState {
  shell: SettingsFormShell
  field: SettingsFieldState
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
