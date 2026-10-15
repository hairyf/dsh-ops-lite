import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME } from './constants'
import { apply as applyPtc } from './ops/ptc/index.js'

export const name = `${PACKAGE_NAME}/ptc`
export const inject = ['tools', 'systemPrompt', 'sandboxPolicy', 'subprocess']

export function apply(ctx: Context): void {
  applyPtc(ctx, { required: true })
}
