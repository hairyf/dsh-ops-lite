#!/usr/bin/env node
import type { OpsConfig, RuntimeKind } from './types'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { DEFAULT_CONFIG } from './constants'
import { resolveNativeWorker, resolveRuntime, resolveRuntimes, upstreamRoot } from './runtimes'

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'bash': { type: 'boolean' },
      'pwsh': { type: 'boolean' },
      'fastctx': { type: 'boolean' },
      'managed': { type: 'boolean' },
      'allow-local': { type: 'boolean' },
      'bash-path': { type: 'string' },
      'pwsh-path': { type: 'string' },
      'fastctx-path': { type: 'string' },
      'force': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  })
  const command = positionals[0] ?? 'help'
  if (positionals.length > 1 || !['help', 'doctor', 'provision'].includes(command))
    throw new Error('Usage: dsh-ops-next doctor | provision --bash|--pwsh|--fastctx [--allow-local] [--managed] [--dry-run] [--force]')
  if (command === 'help') {
    console.log('dsh-ops-next doctor [--allow-local] [--managed]\ndsh-ops-next provision --bash|--pwsh|--fastctx [--allow-local] [--managed] [--dry-run] [--force]\nOptional --bash-path/--pwsh-path/--fastctx-path require absolute paths and --allow-local.\nLocal consent applies to this CLI invocation only. Save the plugin setting separately.\nOnly explicit provision downloads/builds software; never changes system PATH or a Harness profile.')
    return 0
  }
  const config: OpsConfig = {
    ...DEFAULT_CONFIG,
    enableBackground: true,
    runtimeMode: values.managed ? 'managed' : 'local-first',
    allowLocalRuntimes: values['allow-local'] === true,
    bashPath: values['bash-path'] ?? '',
    pwshPath: values['pwsh-path'] ?? '',
    fastctxPath: values['fastctx-path'] ?? '',
  }
  for (const file of [config.bashPath, config.pwshPath, config.fastctxPath]) {
    if (file && (!path.isAbsolute(file) || /[\0\r\n]/.test(file)))
      throw new Error('Executable selections must be absolute paths without NUL or line breaks.')
  }
  if (command === 'doctor') {
    console.log(JSON.stringify({ ...(await resolveRuntimes(config)), worker: await resolveNativeWorker(config) }, null, 2))
    return 0
  }
  const kinds = (['bash', 'pwsh', 'fastctx'] as const).filter(kind => values[kind])
  if (!kinds.length)
    throw new Error('Select at least one runtime: --bash, --pwsh or --fastctx. Nothing was installed.')
  let failed = false
  for (const kind of kinds) {
    const current = await resolveRuntime(kind, config)
    if (current.available && !values.force) {
      console.log(`${kind}: reusing ${current.source} ${current.file}\n${current.detail}`)
      continue
    }
    // An explicit local path is authoritative even for provision; never download behind a typo.
    if (!current.available && current.source === 'local:config') {
      console.error(`${kind}: ${current.detail}\n${JSON.stringify(current.tried)}`)
      failed = true
      continue
    }
    const args = kind === 'fastctx' ? ['provision'] : ['provision-shells', `--${kind}`]
    if (values.force || current.tried.some(attempt => attempt.source === 'managed' && /digest|provenance|SHA-256/i.test(attempt.detail)))
      args.push('--force')
    if (values['dry-run']) {
      console.log(`${kind}: would run the pinned upstream ${args.join(' ')} (no downloads or writes).`)
      continue
    }
    console.log(`${kind}: explicit on-demand provisioning; existing host configuration and system PATH are unchanged.`)
    const result = spawnSync(process.execPath, [path.join(upstreamRoot, 'bin', 'dsh-ops.mjs'), ...args], { stdio: 'inherit', windowsHide: true })
    if (result.error)
      throw result.error
    if (result.status !== 0) {
      failed = true
      continue
    }
    const installed = await resolveRuntime(kind as RuntimeKind, { ...config, runtimeMode: 'managed' })
    if (!installed.available) {
      console.error(`${kind}: installation failed compatibility/provenance verification: ${JSON.stringify(installed)}`)
      failed = true
    }
  }
  return failed ? 1 : 0
}

main().then((code) => {
  process.exitCode = code
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
