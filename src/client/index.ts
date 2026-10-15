import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpsConfig } from '../types'
import { ConfigurationPage } from './configuration-page'
import { CONFIGURATION_ENTRY_ID, CONFIGURATION_KEY, CONFIGURATION_REGISTRANT, CONFIGURATION_SLOT } from './constants'
import { mountConfigurationStyles } from './styles'

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.effect(mountConfigurationStyles)
  ctx.inject(['configForms'], (branch) => {
    const configScope = branch.configForms.get<OpsConfig>(CONFIGURATION_ENTRY_ID)
    branch.slots.inject(CONFIGURATION_SLOT, () => branch.slots.register({
      name: CONFIGURATION_SLOT,
      key: CONFIGURATION_KEY,
      registrant: CONFIGURATION_REGISTRANT,
      inject: () => ({ configScope }),
    }, ConfigurationPage))
  })
}
