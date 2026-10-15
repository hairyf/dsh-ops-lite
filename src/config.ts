import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIG } from './constants'

export const Config = Schema.object({
  disableOfficialTools: Schema.boolean().default(DEFAULT_CONFIG.disableOfficialTools).description('禁用官方基础工具，不改变权限或沙箱'),
}).default({}).volatile()
