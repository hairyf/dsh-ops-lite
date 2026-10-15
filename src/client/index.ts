import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpsConfig } from '../types'
import type { ConfigurationState } from './types'
import { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfigurationPage } from './configuration-page'
import { CONFIGURATION_ENTRY_ID, CONFIGURATION_FIELD, CONFIGURATION_KEY, CONFIGURATION_REGISTRANT, CONFIGURATION_SLOT, FIELD_SPECS } from './constants'
import { mountConfigurationStyles } from './styles'

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.effect(mountConfigurationStyles)
  ctx.inject(['configForms'], (branch) => {
    const configScope = branch.configForms.get<OpsConfig>(CONFIGURATION_ENTRY_ID)
    const scope: SettingsFormScope<OpsConfig> = {
      getSnapshot: () => {
        const snapshot = configScope.getSnapshot()
        return { ...snapshot, writable: snapshot.writable && snapshot.mode === 'host' }
      },
      subscribe: listener => configScope.subscribe(listener),
      mutate: (ops, revision) => {
        const writes: Parameters<typeof configScope.mutate>[0][number][] = []
        for (const op of ops) {
          if (op.path.length !== 1 || op.path[0] !== CONFIGURATION_FIELD)
            return Promise.resolve(false)
          if (op.op === 'unset') {
            writes.push({ op: 'unset', path: [CONFIGURATION_FIELD] })
          }
          else if (typeof op.value === 'boolean') {
            writes.push({ op: 'set', path: [CONFIGURATION_FIELD], value: op.value })
          }
          else {
            return Promise.resolve(false)
          }
        }
        return configScope.mutate(writes, revision)
      },
    }
    branch.slots.inject(CONFIGURATION_SLOT, function* () {
      const model = new SettingsFormModel(scope, FIELD_SPECS)
      yield () => model.dispose()
      const source = model.bind((): ConfigurationState => ({
        shell: model.shell(),
        field: model.field(CONFIGURATION_FIELD),
      }))
      const formActions = model.actions()
      yield branch.slots.register({
        name: CONFIGURATION_SLOT,
        key: CONFIGURATION_KEY,
        registrant: CONFIGURATION_REGISTRANT,
        inject: () => ({ hooks: { configuration: source }, formActions }),
      }, ConfigurationPage)
    })
  })
}
