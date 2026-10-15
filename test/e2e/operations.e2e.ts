import type { Locator, Page } from '@playwright/test'
import type { Host, Scope } from './host'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { expect, test } from './host'

const officialTools = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent']
const fileTools = ['ops_inspect_local_file', 'ops_grep', 'ops_glob', 'ops_replace']
const defaultTools = ['ops_bash', ...fileTools]
const backgroundTools = ['ops_run_background', 'ops_job_output', 'ops_job_list', 'ops_job_kill']
const ptcTools = ['ops_batch', 'ops_result']

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(?:Plugins|插件)$/ }).click()
  await page.getByRole('button', { name: /^(?:View|查看) .*dsh-ops-next/i }).click()
}

async function reloadSettings(page: Page): Promise<void> {
  await page.reload()
  await page.getByRole('dialog', { name: 'Add an API key to get started', exact: true }).getByRole('button', { name: 'Configure later', exact: true }).click()
  await openSettings(page)
}

async function names(host: Host, scope: Scope = 'native'): Promise<string[]> {
  return (await host.schemas(scope)).schemas.map(schema => schema.name)
}

function component(page: Page, title: string): Locator {
  return page.getByRole('switch', { name: `Enable component ${title}`, exact: true })
}

test('isolated Harness L2: independent components, immediate policy saving, native execution and sandbox boundaries', async ({ page, host }, info) => {
  await info.attach('actual runner', {
    body: JSON.stringify({ platform: process.platform, arch: process.arch, layer: 'L2 isolated Harness web + Chromium; not Tauri L3' }),
    contentType: 'application/json',
  })

  await test.step('Shell and file work by default, optional components are off, and official tools are disabled', async () => {
    expect(await names(host)).toEqual(expect.arrayContaining(defaultTools))
    expect((await names(host)).filter(name => backgroundTools.includes(name))).toEqual([])
    expect((await names(host, 'ptc')).filter(name => ptcTools.includes(name))).toEqual([])
    expect(await names(host)).toContain('read_image')
    expect((await names(host, 'inherited')).filter(name => officialTools.includes(name))).toEqual([])
    const presentation = await host.schemas()
    expect(presentation.wireTools.filter(name => officialTools.includes(name))).toEqual([])
    expect(presentation.sections.filter(section => officialTools.some(name => section.name === `tool:${name}`))).toEqual([])
    const args = { file_path: path.join(host.workspace, 'native.txt') }
    expect((await host.call('read', args)).isError).toBe(true)
    expect((await host.call('read', args, 'inherited')).isError).toBe(true)
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

  await page.goto(host.url)
  await page.getByRole('dialog', { name: 'Preview Notice', exact: true }).getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add an API key to get started', exact: true }).getByRole('button', { name: 'Configure later', exact: true }).click()
  await openSettings(page)

  await test.step('four real component entries expose their upstream defaults and enable optional runtimes', async () => {
    await expect(component(page, 'dsh-ops-bash & powershell 7')).toBeChecked()
    await expect(component(page, 'dsh-ops-file')).toBeChecked()
    await expect(component(page, 'dsh-ops-background')).not.toBeChecked()
    await expect(component(page, 'dsh-ops-ptc')).not.toBeChecked()
    await component(page, 'dsh-ops-background').click()
    await expect(component(page, 'dsh-ops-background')).toBeChecked()
    await expect.poll(() => names(host)).toEqual(expect.arrayContaining(backgroundTools))
    await component(page, 'dsh-ops-ptc').click()
    await expect(component(page, 'dsh-ops-ptc')).toBeChecked()
    await expect.poll(() => names(host, 'ptc')).toEqual(expect.arrayContaining(ptcTools))
  })

  await test.step('FastCtx runs, reads, lists and kills only this real session’s background job', async () => {
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

  await test.step('PTC is published only in pure PTC and executes a real run_code native copy', async () => {
    expect((await names(host)).filter(name => ptcTools.includes(name))).toEqual([])
    const presentation = await host.schemas('ptc')
    expect(presentation.wireTools).toEqual(['run_code'])
    const executed = await host.call('run_code', {
      description: 'Copy native file via real PTC tool SDK',
      code: 'return await tools.ops_batch({action:"run",operations:[{op:"copy",path:"native.txt",to:"ptc-copy.txt"}]});',
    }, 'ptc')
    expect(executed.isError, JSON.stringify(executed)).not.toBe(true)
    expect(await readFile(path.join(host.workspace, 'ptc-copy.txt'), 'utf8')).toBe('after-e2e\n')
  })

  await test.step('each independent component really unregisters and restores its own tools', async () => {
    const components: { title: string, scope: Scope, tools: string[], name: string, args: Record<string, unknown> }[] = [
      { title: 'dsh-ops-bash & powershell 7', scope: 'native', tools: ['ops_bash'], name: 'ops_bash', args: { command: 'printf OPS_REENABLED', workdir: host.workspace } },
      { title: 'dsh-ops-file', scope: 'native', tools: fileTools, name: 'ops_inspect_local_file', args: { path: 'native.txt' } },
      { title: 'dsh-ops-background', scope: 'native', tools: backgroundTools, name: 'ops_job_list', args: { status: 'all', limit: 10, offset: 0 } },
      { title: 'dsh-ops-ptc', scope: 'ptc', tools: ptcTools, name: 'ops_batch', args: { action: 'plan', operations: [{ op: 'copy', path: 'native.txt', to: 'ptc-restored.txt' }] } },
    ]
    for (const entry of components) {
      const toggle = component(page, entry.title)
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect.poll(async () => (await names(host, entry.scope)).filter(name => entry.tools.includes(name))).toEqual([])
      expect((await host.call(entry.name, entry.args, entry.scope)).isError).toBe(true)
      if (entry.scope === 'ptc')
        expect(await names(host)).toEqual(expect.arrayContaining(defaultTools))
      else if (entry.name === 'ops_bash')
        expect(await names(host)).toEqual(expect.arrayContaining(fileTools))
      else expect(await names(host)).toContain('ops_bash')
      if (entry.name === 'ops_inspect_local_file') {
        expect(await names(host, 'inherited')).toContain('read')
        expect((await host.call('read', { file_path: path.join(host.workspace, 'native.txt') })).isError).not.toBe(true)
      }
      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect.poll(() => names(host, entry.scope)).toEqual(expect.arrayContaining(entry.tools))
      const restored = await host.call(entry.name, entry.args, entry.scope)
      expect(restored.isError, JSON.stringify(restored)).not.toBe(true)
      if (entry.name === 'ops_bash') {
        expect(restored.value.exitCode, JSON.stringify(restored)).toBe(0)
        expect(restored.value.stdout.text).toBe('OPS_REENABLED')
      }
      if (entry.name === 'ops_inspect_local_file') {
        expect(restored.value.status, JSON.stringify(restored)).toBe('completed')
        expect((await host.call('read', { file_path: path.join(host.workspace, 'native.txt') })).isError).toBe(true)
      }
    }
  })

  await test.step('the default-on official-tools policy saves immediately and survives reload without changing the sandbox', async () => {
    const setting = page.getByRole('switch', { name: '禁用官方基础工具', exact: true })
    await expect(setting).toBeChecked()
    await expect(page.getByText('开启后禁用官方基础文件与 Shell 工具，保留 read_image，不改变权限或沙箱。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^(?:保存设置|Save settings|Discard|丢弃)$/ })).toHaveCount(0)
    await expect(page.getByText(/修改先保留为草稿|公开 SDK 无法隐藏/)).toHaveCount(0)
    const args = { file_path: path.join(host.workspace, 'native.txt') }
    await setting.click()
    await expect(setting).not.toBeChecked()
    await expect.poll(() => names(host, 'inherited')).toContain('read')
    expect((await host.schemas()).wireTools).toContain('read')
    expect((await host.call('read', args, 'inherited')).isError).not.toBe(true)
    const restored = await host.call('read', args)
    expect(restored.isError, JSON.stringify(restored)).not.toBe(true)
    const nativeDenied = await host.call('ops_replace', { path: host.outside, pattern: 'outside-unchanged', replacement: 'MUST_NOT_WRITE' }, 'confined')
    expect(nativeDenied.value.error.code, JSON.stringify(nativeDenied)).toBe('POLICY_DENIED')
    expect(await readFile(host.outside, 'utf8')).toBe('outside-unchanged\n')
    await reloadSettings(page)
    await expect(setting).not.toBeChecked()
    expect((await host.call('read', args, 'inherited')).isError).not.toBe(true)
    await setting.click()
    await expect(setting).toBeChecked()
    await expect.poll(async () => (await names(host, 'inherited')).filter(name => officialTools.includes(name))).toEqual([])
    expect((await host.schemas()).wireTools.filter(name => officialTools.includes(name))).toEqual([])
    // Registry visibility depends on the SDK scope; model presentation and execution must both exclude official tools.
    expect((await host.call('read', args, 'inherited')).isError).toBe(true)
    const denied = await host.call('read', args)
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toMatch(/disabled|denied|not found|not available|unknown tool/i)
    expect(await names(host)).toContain('read_image')
    expect((await host.call('ops_inspect_local_file', { path: 'native.txt' })).value.status).toBe('completed')
    expect(await names(host)).toEqual(expect.arrayContaining(defaultTools))
    await reloadSettings(page)
    await expect(setting).toBeChecked()
    expect((await host.call('read', args)).isError).toBe(true)
    for (const title of ['dsh-ops-bash & powershell 7', 'dsh-ops-file', 'dsh-ops-background', 'dsh-ops-ptc'])
      await expect(component(page, title)).toBeChecked()
  })
})
