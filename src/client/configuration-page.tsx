import type { ReactElement } from 'react'
import type { ConfigurationProps } from './types'
import { Button, SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CLASSES, CLI_COMMANDS, COMPONENT_TOGGLES, CONFIGURATION_ID_PREFIX, FORM_LABELS, POLICY_TOGGLES, RUNTIME_PATHS } from './constants'

export function ConfigurationPage({ view, useConfiguration, formActions }: ConfigurationProps): ReactElement {
  const { shell, fields } = useConfiguration(state => state)
  const disabled = !shell.available || !shell.writable || shell.saving

  if (view === 'summary') {
    return <p className={CLASSES.summary}>按需启用 Shell、文件、后台任务与 PTC；本机运行时须明确授权。</p>
  }

  function renderToggles(toggles: typeof COMPONENT_TOGGLES | typeof POLICY_TOGGLES): ReactElement {
    return (
      <ul>
        {toggles.map(({ field, label, description }) => (
          <li className={CLASSES.row} key={field}>
            <span className={CLASSES.rowText}>
              <span className={CLASSES.rowTitle}>{label}</span>
              <span className={CLASSES.rowDescription}>{description}</span>
            </span>
            <Switch
              checked={fields[field].text === 'true'}
              disabled={disabled}
              label={label}
              onChange={next => formActions.edit(field, String(next))}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className={CLASSES.root}>
      <p className={CLASSES.help}>调整后的设置先保留为草稿，点击保存后一次提交到宿主；离开此页会丢弃未保存的修改。</p>
      <SettingsForm labels={FORM_LABELS} state={shell} onSave={formActions.save} onDiscard={formActions.discard}>
        <div className={CLASSES.cards}>
          <section className={CLASSES.card}>
            <h3 className={CLASSES.heading}>组件</h3>
            <p className={CLASSES.help}>默认仅开启 Shell 与文件操作；开启组件不等于授予会话权限。</p>
            {renderToggles(COMPONENT_TOGGLES)}
          </section>
          <section className={CLASSES.card}>
            <h3 className={CLASSES.heading}>运行时与信任</h3>
            <label className={CLASSES.field}>
              <span className={CLASSES.label}>运行时来源</span>
              <select
                aria-label="运行时来源"
                className={CLASSES.select}
                disabled={disabled}
                value={fields.runtimeMode.text}
                onChange={event => formActions.edit('runtimeMode', event.target.value)}
              >
                <option value="local-first">优先本机（需授权）</option>
                <option value="managed">仅托管运行时（固定摘要校验）</option>
              </select>
            </label>
            <p className={CLASSES.notice}>
              本机模式使用你信任和维护的安装，不提供固定摘要保证；必须明确授权后才能使用。
              托管模式保留来源与固定摘要校验，验证失败不会降级为未经校验的执行器。
              插件不会因打开设置而下载或安装运行时。
            </p>
            <div className={CLASSES.row}>
              <span className={CLASSES.rowText}>
                <span className={CLASSES.rowTitle}>授权使用本机运行时</span>
                <span className={CLASSES.rowDescription}>信任本机 Bash、PowerShell 7、FastCtx 或自选 worker；此授权不绕过审批、权限或沙箱。</span>
              </span>
              <Switch
                checked={fields.allowLocalRuntimes.text === 'true'}
                disabled={disabled}
                label="授权使用本机运行时"
                onChange={next => formActions.edit('allowLocalRuntimes', String(next))}
              />
            </div>
            <div className={CLASSES.fields}>
              {RUNTIME_PATHS.map(({ field, label, description }) => (
                <SettingsValueField
                  {...fields[field]}
                  key={field}
                  disabled={disabled}
                  hint={description}
                  id={`${CONFIGURATION_ID_PREFIX}-${field}`}
                  invalidLabel="请输入绝对路径，或留空使用默认解析。"
                  label={label}
                  overriddenLabel="自定义"
                  placeholder="留空使用默认解析"
                  resetLabel="恢复默认"
                  onEdit={text => formActions.edit(field, text)}
                  onReset={() => formActions.resetField(field)}
                />
              ))}
            </div>
          </section>
          <section className={CLASSES.card}>
            <h3 className={CLASSES.heading}>工具与策略</h3>
            {renderToggles(POLICY_TOGGLES)}
            <p className={CLASSES.notice}>禁用官方基础工具只是能力选择，不会放宽文件边界或进程执行规则；请先确认替代组件和运行时可用。</p>
            <SettingsValueField
              {...fields.toolCallTimeoutMs}
              disabled={disabled}
              hint="FastCtx 调用等待上限；超时不代表服务端任务已终止。"
              id={`${CONFIGURATION_ID_PREFIX}-toolCallTimeoutMs`}
              invalidLabel="请输入 1 到 2147483647 的整数毫秒值。"
              label="调用超时（毫秒）"
              numeric
              overriddenLabel="自定义"
              resetLabel="恢复默认"
              onEdit={text => formActions.edit('toolCallTimeoutMs', text)}
              onReset={() => formActions.resetField('toolCallTimeoutMs')}
            />
            <label className={CLASSES.field}>
              <span className={CLASSES.label}>附加工具说明</span>
              <textarea
                aria-label="附加工具说明"
                className={CLASSES.textarea}
                disabled={disabled}
                rows={3}
                value={fields.extraGuidance.text}
                onChange={event => formActions.edit('extraGuidance', event.target.value)}
              />
            </label>
          </section>
        </div>
        {shell.invalid ? <p className={CLASSES.invalid} role="alert">存在无效输入，请修正后再保存；修改尚未提交。</p> : null}
        {shell.dirty ? <Button disabled={disabled} variant="ghost" onClick={formActions.discard}>放弃修改</Button> : null}
      </SettingsForm>
      <section className={CLASSES.cli}>
        <h3 className={CLASSES.heading}>运行时准备（CLI）</h3>
        <p className={CLASSES.help}>以下命令由你在终端显式执行；此页面没有下载接口，也不会执行命令。</p>
        {CLI_COMMANDS.map(({ label, command }) => (
          <div className={CLASSES.cliCommand} key={command}>
            <span>{label}</span>
            <code>{command}</code>
          </div>
        ))}
      </section>
    </section>
  )
}
