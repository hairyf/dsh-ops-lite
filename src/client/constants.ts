import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OpsConfig } from '../types'
import type { PathDefinition, ToggleDefinition } from './types'
import { CONFIG_ROW_ID, DEFAULT_CONFIG, PACKAGE_NAME } from '../constants'

export const CONFIGURATION_SLOT = 'plugins.bundle.config'
export const CONFIGURATION_KEY = PACKAGE_NAME
export const CONFIGURATION_REGISTRANT = PACKAGE_NAME
export const CONFIGURATION_ENTRY_ID = CONFIG_ROW_ID
export const CONFIGURATION_ID_PREFIX = PACKAGE_NAME
export const STYLE_TAG_ID = `${PACKAGE_NAME}/configuration.css`
export const CONFIGURATION_FIELDS = Object.keys(DEFAULT_CONFIG) as (keyof OpsConfig)[]

export const FORM_LABELS = {
  unavailable: '宿主尚未提供此插件的配置；请确认插件已启用并已连接。',
  readOnly: '当前连接不可写，无法保存到宿主配置。',
  saveFailed: '宿主未接受修改。草稿已保留；请检查权限、配置或并发修改后重试。',
  save: '保存设置',
  saving: '正在保存…',
} satisfies SettingsFormLabels

export const COMPONENT_TOGGLES = [
  { field: 'enableShell', label: 'Shell', description: '通过本机或托管执行器提供 ops_bash；始终服从会话权限和沙箱。' },
  { field: 'enableFile', label: '文件操作', description: '提供文件读取、搜索、匹配与替换，保留宿主文件边界与 revision 检查。' },
  { field: 'enableBackground', label: '后台任务', description: '显式启用后管理长任务；命令工具仍需会话完全权限。' },
  { field: 'enablePtc', label: '程序化工具调用（PTC）', description: '显式启用工具编排；不授予额外工具能力或更高权限。' },
] as const satisfies readonly ToggleDefinition[]

export const POLICY_TOGGLES = [
  { field: 'disableOfficialTools', label: '禁用官方基础工具', description: '禁用官方基础文件与 Shell 工具，使用 Ops 替代；保留 read_image、审批、提问与插件管理，不改变权限。' },
  { field: 'promptPolicy', label: '注入工具使用说明', description: '向模型说明可用工具及权限边界；关闭不会放宽校验。' },
  { field: 'publishBashTool', label: '发布 ops_bash', description: '只有 Shell 组件开启、执行器可用且会话权限允许时才发布。' },
  { field: 'enableShellTools', label: '发布后台命令工具', description: '仅影响后台组件；组件开启与会话完全权限缺一不可。' },
  { field: 'required', label: '缺少运行时即报错', description: '运行时缺失时明确报错，而非静默跳过对应能力。' },
] as const satisfies readonly ToggleDefinition[]

export const RUNTIME_PATHS = [
  { field: 'bashPath', label: 'Bash 路径', description: '本机 Bash 的绝对路径；留空按运行时模式查找。' },
  { field: 'pwshPath', label: 'PowerShell 7 路径', description: '本机 pwsh 的绝对路径；不使用旧版 Windows PowerShell。' },
  { field: 'fastctxPath', label: 'FastCtx 路径', description: '本机 FastCtx 的绝对路径；仅后台组件按需使用，PTC 使用 native worker。' },
  { field: 'workerPath', label: '文件 worker 路径', description: '可选自定义 worker 绝对路径；留空使用插件随附副本。' },
] as const satisfies readonly PathDefinition[]

export const CLI_COMMANDS = [
  { label: '检查运行时与来源', command: 'dsh-ops-next doctor' },
  { label: '只读探测已授权本机运行时（不下载）', command: 'dsh-ops-next doctor --allow-local' },
  { label: '显式准备托管 Shell（仅 Windows x64 有固定版本；Linux/macOS 请授权本机 Shell）', command: 'dsh-ops-next provision --bash --pwsh --managed' },
  { label: '显式准备托管后台运行时', command: 'dsh-ops-next provision --fastctx --managed' },
] as const

export const CLASSES = {
  root: 'dsh-ops-next-config',
  summary: 'dsh-ops-next-summary',
  heading: 'dsh-ops-next-heading',
  help: 'dsh-ops-next-help',
  cards: 'dsh-ops-next-cards',
  card: 'dsh-ops-next-card',
  row: 'dsh-ops-next-row',
  rowText: 'dsh-ops-next-row-text',
  rowTitle: 'dsh-ops-next-row-title',
  rowDescription: 'dsh-ops-next-row-description',
  notice: 'dsh-ops-next-notice',
  fields: 'dsh-ops-next-fields',
  field: 'dsh-ops-next-field',
  label: 'dsh-ops-next-label',
  textarea: 'dsh-ops-next-textarea',
  select: 'dsh-ops-next-select',
  invalid: 'dsh-ops-next-invalid',
  cli: 'dsh-ops-next-cli',
  cliCommand: 'dsh-ops-next-cli-command',
} as const
