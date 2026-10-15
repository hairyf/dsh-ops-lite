#!/usr/bin/env node
import process from 'node:process'
import { provisionShells } from '../src/ops/provision.js'
import { SHELL_PROVISION_COMMAND } from '../src/ops/shell-payloads.js'

const args = process.argv.slice(2)
const postinstall = args.length === 1 && args[0] === '--postinstall'
try {
  const forceManaged = args.length === 1 && args[0] === '--force-managed'
  if (args.length && !postinstall && !forceManaged)
    throw new Error(`Unknown arguments. Repair with ${SHELL_PROVISION_COMMAND} [--force-managed]; select shells using DSH_OPS_SHELLS=bash|pwsh|both|none.`)
  const result = provisionShells({ env: forceManaged ? { ...process.env, DSH_OPS_FORCE_MANAGED_SHELLS: '1' } : process.env })
  if (result.failed && !postinstall)
    process.exitCode = 1
}
catch (error) {
  console.warn(`dsh-ops-lite: shell provisioning skipped: ${error.message ?? error}. Repair with ${SHELL_PROVISION_COMMAND}.`)
  if (!postinstall)
    process.exitCode = 1
}
