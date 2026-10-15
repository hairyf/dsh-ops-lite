import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIG, OFFICIAL_TOOLS_DESCRIPTION } from './constants'

export const Config = Schema.object({
  disableOfficialTools: Schema.boolean().default(DEFAULT_CONFIG.disableOfficialTools).description(OFFICIAL_TOOLS_DESCRIPTION),
}).default({}).volatile()
