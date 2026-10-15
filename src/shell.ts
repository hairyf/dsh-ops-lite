import type { Context } from '@deepseek-ai/cordis'
import process from 'node:process'
import { PACKAGE_NAME } from './constants'
import { applyComponent } from './ops/index.js'

export const name = `${PACKAGE_NAME}/shell`
export const inject = ['tools', 'sandboxPolicy', 'subprocess']

export function apply(ctx: Context): void {
  applyComponent(ctx, { required: true, allowSystemShellFallback: process.platform !== 'win32' }, 'shell')
}
