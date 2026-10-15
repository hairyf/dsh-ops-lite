import Schema from '@deepseek-ai/schemastery'
import { ABSOLUTE_RUNTIME_PATH, DEFAULT_CONFIG, MAX_TOOL_CALL_TIMEOUT_MS } from './constants'

const runtimePath = Schema.string().pattern(ABSOLUTE_RUNTIME_PATH).default('')

export const Config = Schema.object({
  enableShell: Schema.boolean().default(DEFAULT_CONFIG.enableShell).description('启用 Shell 组件'),
  enableFile: Schema.boolean().default(DEFAULT_CONFIG.enableFile).description('启用文件组件'),
  enableBackground: Schema.boolean().default(DEFAULT_CONFIG.enableBackground).description('启用后台任务组件'),
  enablePtc: Schema.boolean().default(DEFAULT_CONFIG.enablePtc).description('启用程序化工具调用组件'),
  disableOfficialTools: Schema.boolean().default(DEFAULT_CONFIG.disableOfficialTools).description('禁用官方基础工具，不改变权限或沙箱'),
  runtimeMode: Schema.union(['local-first', 'managed']).default(DEFAULT_CONFIG.runtimeMode).description('运行时来源模式'),
  allowLocalRuntimes: Schema.boolean().default(DEFAULT_CONFIG.allowLocalRuntimes).description('明确授权使用未经固定摘要校验的本机运行时'),
  bashPath: runtimePath.description('本机 Bash 可执行文件的绝对路径；留空自动发现'),
  pwshPath: runtimePath.description('本机 PowerShell 7 可执行文件的绝对路径；留空自动发现'),
  fastctxPath: runtimePath.description('本机 FastCtx 可执行文件的绝对路径；留空自动发现'),
  workerPath: runtimePath.description('文件 worker 的绝对路径；留空使用插件随附副本'),
  promptPolicy: Schema.boolean().default(DEFAULT_CONFIG.promptPolicy).description('提供工具路由与权限说明'),
  publishBashTool: Schema.boolean().default(DEFAULT_CONFIG.publishBashTool).description('在权限允许且执行器可用时发布 ops_bash'),
  enableShellTools: Schema.boolean().default(DEFAULT_CONFIG.enableShellTools).description('在权限允许时发布后台命令工具'),
  required: Schema.boolean().default(DEFAULT_CONFIG.required).description('所需运行时不可用时明确报错'),
  toolCallTimeoutMs: Schema.natural().min(1).max(MAX_TOOL_CALL_TIMEOUT_MS).default(DEFAULT_CONFIG.toolCallTimeoutMs).description('FastCtx 调用等待超时（毫秒）'),
  extraGuidance: Schema.string().default(DEFAULT_CONFIG.extraGuidance).description('附加工具使用说明'),
}).default({}).volatile()
