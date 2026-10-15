import type { ReactElement } from 'react'
import type { ConfigurationProps } from './types'
import { SettingsForm, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CLASSES, CONFIGURATION_FIELD, FORM_LABELS, SCHEMA_NOTICE, TOGGLE_DESCRIPTION, TOGGLE_LABEL } from './constants'

export function ConfigurationPage({ view, useConfiguration, formActions }: ConfigurationProps): ReactElement {
  const { shell, field } = useConfiguration(state => state)
  const disabled = !shell.available || !shell.writable || shell.saving

  if (view === 'summary') {
    return <p className={CLASSES.summary}>可选择禁用官方基础工具，保留 read_image。</p>
  }

  return (
    <section className={CLASSES.root}>
      <p className={CLASSES.help}>修改先保留为草稿，点击保存后提交到宿主；离开此页会丢弃未保存的修改。</p>
      <SettingsForm labels={FORM_LABELS} state={shell} onSave={formActions.save} onDiscard={formActions.discard}>
        <div className={CLASSES.row}>
          <span className={CLASSES.rowText}>
            <span className={CLASSES.rowTitle}>{TOGGLE_LABEL}</span>
            <span className={CLASSES.rowDescription}>{TOGGLE_DESCRIPTION}</span>
          </span>
          <Switch
            checked={field.text === 'true'}
            disabled={disabled}
            label={TOGGLE_LABEL}
            title={TOGGLE_DESCRIPTION}
            onChange={next => formActions.edit(CONFIGURATION_FIELD, String(next))}
          />
        </div>
        <p className={CLASSES.notice}>{SCHEMA_NOTICE}</p>
      </SettingsForm>
    </section>
  )
}
