import type { Page } from '@playwright/test'
import type { Host, Scope } from './host'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { expect, test } from './host'

const officialTools = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent']
const defaultTools = ['ops_bash', 'ops_inspect_local_file', 'ops_grep', 'ops_glob', 'ops_replace']
const backgroundTools = ['ops_run_background', 'ops_job_output', 'ops_job_list', 'ops_job_kill']

async function openSettings(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.getByRole('button', { name: /^(?:Plugins|插件)$/ }).click()
  await page.getByRole('button', { name: /^(?:View|查看) .*dsh-ops-next/i }).click()
}

async function save(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '保存设置', exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toBeDisabled()
  await expect(page.getByText('宿主未接受修改。', { exact: false })).toHaveCount(0)
}

async function names(host: Host, scope: Scope = 'native'): Promise<string[]> {
  return (await host.schemas(scope)).schemas.map(schema => schema.name)
}

test('isolated Harness L2: five tools work by default, permissions hold, and official-tool setting persists', async ({ page, host }, info) => {
  await info.attach('actual runner', {
    body: JSON.stringify({ platform: process.platform, arch: process.arch, layer: 'L2 isolated Harness web + Chromium; not Tauri L3' }),
    contentType: 'application/json',
  })

  await test.step('all five tools are available before any configuration is opened or saved', async () => {
    expect(await names(host)).toEqual(expect.arrayContaining(defaultTools))
    expect(await names(host)).toEqual(expect.arrayContaining(backgroundTools))
  })

  await test.step('default native tools read, atomically replace, search, glob and execute Bash', async () => {
    const before = await host.call('ops_inspect_local_file', { path: 'native.txt' })
    expect(before.isError, JSON.stringify(before)).not.toBe(true)
    expect(before.value.status).toBe('completed')
    expect(JSON.stringify(before.value)).toContain('before-e2e')
    const replace = await host.call('ops_replace', { path: 'native.txt', pattern: 'before-e2e', replacement: 'after-e2e' })
    expect(replace.isError, JSON.stringify(replace)).not.toBe(true)
    expect(replace.value.changed).toBe(1)
    expect(await readFile(path.join(host.workspace, 'native.txt'), 'utf8')).toBe('after-e2e\n')
    const grep = await host.call('ops_grep', { path: '.', pattern: 'after-e2e', glob: ['*.txt'] })
    expect(grep.isError, JSON.stringify(grep)).not.toBe(true)
    expect(grep.value.matched).toBe(1)
    const glob = await host.call('ops_glob', { path: '.', pattern: ['*.txt'] })
    expect(glob.isError, JSON.stringify(glob)).not.toBe(true)
    expect(JSON.stringify(glob.value.items)).toContain('native.txt')
    const bash = await host.call('ops_bash', { command: 'printf OPS_SHELL_OK', workdir: host.workspace, timeoutMs: 10_000 })
    expect(bash.isError, JSON.stringify(bash)).not.toBe(true)
    expect(bash.value.exitCode, JSON.stringify(bash)).toBe(0)
    expect(bash.value.stdout.text).toBe('OPS_SHELL_OK')
  })

  await test.step('workspace-write allows real Bash writes but denies shell and native writes outside its roots', async () => {
    expect(await names(host, 'confined')).toEqual(expect.arrayContaining(defaultTools))
    const allowed = await host.call('ops_bash', { command: 'printf OPS_CONFINED_OK > confined.txt; cat confined.txt', workdir: host.workspace, timeoutMs: 20_000 }, 'confined')
    expect(allowed.isError, JSON.stringify(allowed)).not.toBe(true)
    expect(allowed.value.exitCode, JSON.stringify(allowed)).toBe(0)
    expect(allowed.value.sandbox.mode).toBe('workspace-write')
    expect(['full', 'partial']).toContain(allowed.value.sandbox.enforcement)
    expect(await readFile(path.join(host.workspace, 'confined.txt'), 'utf8')).toBe('OPS_CONFINED_OK')
    const outside = host.outside.replaceAll('\\', '/').replaceAll('\'', '\'\\\'\'')
    const denied = await host.call('ops_bash', { command: `printf MUST_NOT_WRITE > '${outside}'`, workdir: host.workspace, timeoutMs: 20_000 }, 'confined')
    expect(denied.value.exitCode, JSON.stringify(denied)).not.toBe(0)
    expect(JSON.stringify(denied)).toMatch(/permission denied|operation not permitted|read-only file system|access is denied/i)
    const nativeDenied = await host.call('ops_replace', { path: host.outside, pattern: 'outside-unchanged', replacement: 'MUST_NOT_WRITE' }, 'confined')
    expect(nativeDenied.value.status, JSON.stringify(nativeDenied)).toBe('rejected')
    expect(nativeDenied.value.error.code).toBe('POLICY_DENIED')
    expect(await readFile(host.outside, 'utf8')).toBe('outside-unchanged\n')
  })

  await test.step('default FastCtx runs, reads, lists and kills only this real session’s background job', async () => {
    const started = await host.call('ops_run_background', { command: 'printf "OPS_BACKGROUND_OK\\n"; sleep 120', cwd: host.workspace, login_shell: false })
    expect(started.isError, JSON.stringify(started)).not.toBe(true)
    const job = /\b(j-[a-z0-9]{6})\b/.exec(JSON.stringify(started))?.[1]
    expect(job, JSON.stringify(started)).toBeTruthy()
    try {
      const output = await host.call('ops_job_output', { job_id: job, wait_ms: 1000 })
      expect(output.isError, JSON.stringify(output)).not.toBe(true)
      expect(JSON.stringify(output)).toContain('OPS_BACKGROUND_OK')
      const listed = await host.call('ops_job_list', { status: 'running', limit: 10, offset: 0 })
      expect(listed.isError, JSON.stringify(listed)).not.toBe(true)
      expect(JSON.stringify(listed)).toContain(job)
      const foreign = await host.call('ops_job_output', { job_id: job, wait_ms: 0 }, 'inherited')
      expect(foreign.isError, JSON.stringify(foreign)).toBe(true)
      expect(JSON.stringify(foreign)).toMatch(/not started by this session/i)
    }
    finally {
      const killed = await host.call('ops_job_kill', { job_id: job })
      expect(killed.isError, JSON.stringify(killed)).not.toBe(true)
      expect(JSON.stringify(killed)).toMatch(/killed/i)
    }
    const terminal = await host.call('ops_job_output', { job_id: job, wait_ms: 1000 })
    expect(terminal.isError, JSON.stringify(terminal)).not.toBe(true)
    expect(JSON.stringify(terminal)).toMatch(/was killed/i)
    const finished = await host.call('ops_job_list', { status: 'finished', limit: 10, offset: 0 })
    expect(finished.isError, JSON.stringify(finished)).not.toBe(true)
    expect(JSON.stringify(finished)).toContain(job)
  })

  await test.step('default PTC is published only in pure PTC and executes a real run_code native copy', async () => {
    expect(await names(host)).not.toContain('ops_batch')
    expect(await names(host)).not.toContain('ops_result')
    await expect.poll(() => names(host, 'ptc')).toEqual(expect.arrayContaining(['ops_batch', 'ops_result']))
    const presentation = await host.schemas('ptc')
    expect(presentation.wireTools).toEqual(['run_code'])
    const executed = await host.call('run_code', {
      description: 'Copy native file via real PTC tool SDK',
      code: 'return await tools.ops_batch({action:"run",operations:[{op:"copy",path:"native.txt",to:"ptc-copy.txt"}]});',
    }, 'ptc')
    expect(executed.isError, JSON.stringify(executed)).not.toBe(true)
    expect(await readFile(path.join(host.workspace, 'ptc-copy.txt'), 'utf8')).toBe('after-e2e\n')
  })

  await page.goto(host.url)
  await page.getByRole('dialog', { name: 'Preview Notice', exact: true }).getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add an API key to get started', exact: true }).getByRole('button', { name: 'Configure later', exact: true }).click()
  await openSettings(page, host.url)

  await test.step('the sole setting stays a draft until save, persists on reload, denies official tools and restores them', async () => {
    const setting = page.getByRole('switch', { name: '禁用官方基础工具', exact: true })
    await expect(setting).toBeVisible()
    await expect(setting).not.toBeChecked()
    const visible = await names(host)
    const baseline = visible.filter(name => officialTools.includes(name))
    expect(baseline).toContain('read')
    const inherited = (await names(host, 'inherited')).filter(name => officialTools.includes(name))
    expect(inherited).toContain('read')
    const args = { file_path: path.join(host.workspace, 'native.txt') }
    expect((await host.call('read', args, 'inherited')).isError).not.toBe(true)
    await setting.check()
    // Editing the browser draft must not alter the host's real tool registry.
    expect((await host.call('read', args, 'inherited')).isError).not.toBe(true)
    await save(page)
    await expect.poll(async () => (await names(host, 'inherited')).filter(name => officialTools.includes(name))).toEqual([])
    // SDK 0.2.1-alpha.1 cannot hide a preset's own registrations. It must still deny execution.
    expect(await names(host)).toContain('read')
    if (visible.includes('read_image'))
      expect(await names(host)).toContain('read_image')
    expect((await host.call('read', args, 'inherited')).isError).toBe(true)
    const denied = await host.call('read', args)
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toMatch(/disabled|denied|not found|not available|unknown tool/i)
    expect((await host.call('ops_inspect_local_file', { path: 'native.txt' })).value.status).toBe('completed')
    expect(await names(host)).toEqual(expect.arrayContaining(defaultTools))
    await openSettings(page, host.url)
    await expect(setting).toBeChecked()
    expect((await host.call('read', args)).isError).toBe(true)
    await setting.uncheck()
    await save(page)
    await expect.poll(async () => (await names(host)).filter(name => officialTools.includes(name)).sort()).toEqual(baseline.sort())
    await expect.poll(async () => (await names(host, 'inherited')).filter(name => officialTools.includes(name)).sort()).toEqual(inherited.sort())
    expect((await host.call('read', args, 'inherited')).isError).not.toBe(true)
    const restored = await host.call('read', args)
    expect(restored.isError, JSON.stringify(restored)).not.toBe(true)
  })
})
