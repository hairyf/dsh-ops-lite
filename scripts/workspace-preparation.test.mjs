import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { prepareWorkspace } from '../src/ops/workspace-preparation.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

it('lets Windows PowerShell resolve its own modules instead of inheriting PowerShell 7 modules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-workspace-'))
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
  vi.stubEnv('pSmOdUlEpAtH', 'incompatible-pwsh7-modules')
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('close', 0))
    return child
  })
  try {
    await prepareWorkspace({ mode: 'workspace-write', workspaceRoot: root }, { platform: 'win32' })
    const [executable, args, options] = vi.mocked(spawn).mock.calls[0]
    expect(executable).toContain('WindowsPowerShell')
    expect(args).toContain('-NoProfile')
    expect(Object.keys(options.env).some(key => key.toLowerCase() === 'psmodulepath')).toBe(false)
    expect(options.env.PATH).toBe(process.env.PATH)
    expect(process.env.pSmOdUlEpAtH).toBe('incompatible-pwsh7-modules')
  }
  finally {
    vi.unstubAllEnvs()
    child.stdout.destroy()
    child.stderr.destroy()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
