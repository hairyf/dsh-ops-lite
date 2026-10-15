import type { Page } from '@playwright/test'
import type { Host, Scope } from './host'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { expect, test } from './host'

const officialTools = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'pwsh_persistent']
const fileTools = ['ops_inspect_local_file', 'ops_grep', 'ops_glob', 'ops_replace']
const backgroundTools = ['ops_run_background', 'ops_job_output', 'ops_job_list', 'ops_job_kill']

async function openSettings(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.getByRole('button', { name: /^(?:Plugins|插件)$/ }).click()
  await page.getByRole('button', { name: /^(?:View|查看) .*dsh-ops-next/i }).click()
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeVisible()
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

async function status(host: Host): Promise<any> {
  const result = await host.call('ops_status')
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return result.value
}

test('isolated Harness L2: save settings and execute all four upstream components', async ({ page, host }, info) => {
  await test.step('defaults require explicit local consent and do not install a runtime', async () => {
    const state = await status(host)
    expect(state.components).toEqual({ shell: true, file: true, background: false, ptc: false })
    expect(state.runtimeMode).toBe('local-first')
    expect(state.allowLocalRuntimes).toBe(false)
    expect(state.disableOfficialTools).toBe(false)
    expect(state.runtimes.bash.available).toBe(false)
    expect(state.runtimes.fastctx.source).toBe('disabled')
    await expect.poll(() => names(host)).toEqual(expect.arrayContaining(fileTools))
    expect(await names(host)).not.toContain('ops_bash')
    expect(await names(host)).not.toEqual(expect.arrayContaining(backgroundTools))
    expect(await names(host, 'ptc')).not.toContain('ops_batch')
  })

  await page.goto(host.url)
  await page.getByRole('dialog', { name: 'Preview Notice', exact: true }).getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add an API key to get started', exact: true }).getByRole('button', { name: 'Configure later', exact: true }).click()
  await openSettings(page, host.url)
  await test.step('invalid runtime paths cannot save; browser changes remain drafts', async () => {
    await expect(page.getByRole('switch', { name: 'Shell', exact: true })).toBeChecked()
    await expect(page.getByRole('switch', { name: '文件操作', exact: true })).toBeChecked()
    await expect(page.getByRole('switch', { name: '后台任务', exact: true })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: '程序化工具调用（PTC）', exact: true })).not.toBeChecked()
    await page.getByLabel('Bash 路径', { exact: true }).fill('relative/bash')
    await expect(page.getByRole('alert')).toContainText('存在无效输入')
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled()
    expect((await status(host)).allowLocalRuntimes).toBe(false)
    await page.getByLabel('Bash 路径', { exact: true }).fill(host.bashPath)
    await page.getByRole('switch', { name: '授权使用本机运行时', exact: true }).check()
    expect((await status(host)).allowLocalRuntimes).toBe(false)
    await save(page)
    await expect.poll(async () => (await status(host)).allowLocalRuntimes).toBe(true)
    await expect.poll(() => names(host)).toContain('ops_bash')
    await page.reload()
    await openSettings(page, host.url)
    await expect(page.getByRole('switch', { name: '授权使用本机运行时', exact: true })).toBeChecked()
    await expect(page.getByLabel('Bash 路径', { exact: true })).toHaveValue(host.bashPath)
  })

  await test.step('native Rust file read, atomic write, search and Bash execute real processes', async () => {
    const before = await host.call('ops_inspect_local_file', { path: 'native.txt' })
    expect(before.isError, JSON.stringify(before)).not.toBe(true)
    expect(before.value.status).toBe('completed')
    expect(JSON.stringify(before.value)).toContain('before-e2e')
    const replace = await host.call('ops_replace', { path: 'native.txt', pattern: 'before-e2e', replacement: 'after-e2e' })
    expect(replace.isError, JSON.stringify(replace)).not.toBe(true)
    expect(replace.value.changed).toBe(1)
    expect(await readFile(path.join(host.workspace, 'native.txt'), 'utf8')).toBe('after-e2e\n')
    const grep = await host.call('ops_grep', { path: '.', pattern: 'after-e2e', glob: ['*.txt'] })
    expect(grep.value.matched).toBe(1)
    const glob = await host.call('ops_glob', { path: '.', pattern: ['*.txt'] })
    expect(JSON.stringify(glob.value.items)).toContain('native.txt')
    const bash = await host.call('ops_bash', { command: 'printf OPS_SHELL_OK', workdir: host.workspace, timeoutMs: 10_000 })
    expect(bash.isError, JSON.stringify(bash)).not.toBe(true)
    expect(bash.value.exitCode, JSON.stringify(bash)).toBe(0)
    expect(bash.value.stdout.text).toBe('OPS_SHELL_OK')
  })

  await test.step('workspace-write runs confined Bash but cannot modify an outside canary', async () => {
    if (host.confinedBashPath !== host.bashPath) {
      await page.getByLabel('Bash 路径', { exact: true }).fill(host.confinedBashPath)
      await save(page)
    }
    await expect.poll(() => names(host, 'confined')).toContain('ops_bash')
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
    expect(await readFile(host.outside, 'utf8')).toBe('outside-unchanged\n')
    if (host.confinedBashPath !== host.bashPath) {
      await page.getByLabel('Bash 路径', { exact: true }).fill(host.bashPath)
      await save(page)
    }
  })

  await test.step('official-tool disable hides inherited globals and guards real preset-owned tools, then restores', async () => {
    const visible = await names(host)
    const baseline = visible.filter(name => officialTools.includes(name))
    expect(baseline).toContain('read')
    const inherited = (await names(host, 'inherited')).filter(name => officialTools.includes(name))
    expect(inherited).toContain('read')
    expect((await host.call('read', { file_path: path.join(host.workspace, 'native.txt') }, 'inherited')).isError).not.toBe(true)
    await page.getByRole('switch', { name: '禁用官方基础工具', exact: true }).check()
    await save(page)
    await expect.poll(async () => (await names(host, 'inherited')).filter(name => officialTools.includes(name))).toEqual([])
    // SDK 0.2.1-alpha.1 cannot hide a preset's own registrations. It must still deny execution.
    expect(await names(host)).toContain('read')
    if (visible.includes('read_image'))
      expect(await names(host)).toContain('read_image')
    expect((await host.call('read', { file_path: path.join(host.workspace, 'native.txt') }, 'inherited')).isError).toBe(true)
    const denied = await host.call('read', { file_path: path.join(host.workspace, 'native.txt') })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toMatch(/disabled|denied|not found|not available|unknown tool/i)
    expect((await host.call('ops_inspect_local_file', { path: 'native.txt' })).value.status).toBe('completed')
    await page.getByRole('switch', { name: '禁用官方基础工具', exact: true }).uncheck()
    await save(page)
    await expect.poll(async () => (await names(host)).filter(name => officialTools.includes(name)).sort()).toEqual(baseline.sort())
    await expect.poll(async () => (await names(host, 'inherited')).filter(name => officialTools.includes(name)).sort()).toEqual(inherited.sort())
    expect((await host.call('read', { file_path: path.join(host.workspace, 'native.txt') }, 'inherited')).isError).not.toBe(true)
    const restored = await host.call('read', { file_path: path.join(host.workspace, 'native.txt') })
    expect(restored.isError, JSON.stringify(restored)).not.toBe(true)
  })

  await test.step('Shell and file component switches remove and restore executable tools', async () => {
    await page.getByRole('switch', { name: 'Shell', exact: true }).uncheck()
    await page.getByRole('switch', { name: '文件操作', exact: true }).uncheck()
    await save(page)
    await expect.poll(async () => (await names(host)).filter(name => [...fileTools, 'ops_bash'].includes(name))).toEqual([])
    expect((await host.call('ops_bash', { command: 'printf MUST_NOT_RUN' })).isError).toBe(true)
    expect((await host.call('ops_inspect_local_file', { path: 'native.txt' })).isError).toBe(true)
    await page.getByRole('switch', { name: 'Shell', exact: true }).check()
    await page.getByRole('switch', { name: '文件操作', exact: true }).check()
    await save(page)
    await expect.poll(() => names(host)).toEqual(expect.arrayContaining([...fileTools, 'ops_bash']))
  })

  await test.step('explicitly provision FastCtx in the test home, then enable and execute background jobs', async () => {
    await host.provisionFastctx()
    await page.getByRole('switch', { name: '后台任务', exact: true }).check()
    await save(page)
    await expect.poll(() => names(host), { timeout: 60_000 }).toEqual(expect.arrayContaining(backgroundTools))
    const state = await status(host)
    expect(state.runtimes.fastctx.available, JSON.stringify(state)).toBe(true)
    expect(state.runtimes.fastctx.source).toBe('managed')
    const started = await host.call('ops_run_background', { command: 'printf OPS_BACKGROUND_OK', cwd: host.workspace, login_shell: false })
    expect(started.isError, JSON.stringify(started)).not.toBe(true)
    const jobId = JSON.stringify(started).match(/j-[a-z0-9]+/i)?.[0]
    expect(jobId, JSON.stringify(started)).toBeTruthy()
    const output = await host.call('ops_job_output', { job_id: jobId, wait_ms: 20_000 })
    expect(output.isError, JSON.stringify(output)).not.toBe(true)
    expect(JSON.stringify(output)).toContain('OPS_BACKGROUND_OK')
    const jobs = await host.call('ops_job_list', { status: 'all' })
    expect(JSON.stringify(jobs)).toContain(jobId)
    expect((await host.call('ops_job_kill', { job_id: jobId })).isError).not.toBe(true)
    await page.getByRole('switch', { name: '后台任务', exact: true }).uncheck()
    await save(page)
    await expect.poll(async () => (await names(host)).filter(name => backgroundTools.includes(name))).toEqual([])
    expect((await host.call('ops_job_list')).isError).toBe(true)
  })

  await test.step('PTC switch controls real run_code SDK operations and native worker effects', async () => {
    await page.getByRole('switch', { name: '程序化工具调用（PTC）', exact: true }).check()
    await save(page)
    await expect.poll(() => names(host, 'ptc')).toEqual(expect.arrayContaining(['ops_batch', 'ops_result']))
    const executed = await host.call('run_code', {
      description: 'Copy native file via real PTC tool SDK',
      code: 'return await tools.ops_batch({action:"run",operations:[{op:"copy",path:"native.txt",to:"ptc-copy.txt"}]});',
    }, 'ptc')
    expect(executed.isError, JSON.stringify(executed)).not.toBe(true)
    expect(await readFile(path.join(host.workspace, 'ptc-copy.txt'), 'utf8')).toBe('after-e2e\n')
    await page.getByRole('switch', { name: '程序化工具调用（PTC）', exact: true }).uncheck()
    await save(page)
    await expect.poll(async () => (await names(host, 'ptc')).filter(name => ['ops_batch', 'ops_result'].includes(name))).toEqual([])
    expect((await host.call('ops_batch', { action: 'plan', operations: [] }, 'ptc')).isError).toBe(true)
  })

  await test.step('managed-only mode never silently falls back to an authorized local Bash', async () => {
    await page.getByLabel('运行时来源', { exact: true }).selectOption('managed')
    await save(page)
    await expect.poll(async () => (await status(host)).runtimeMode).toBe('managed')
    const state = await status(host)
    expect(state.runtimes.bash.available, JSON.stringify(state)).toBe(false)
    expect(await names(host)).not.toContain('ops_bash')
    await page.getByLabel('运行时来源', { exact: true }).selectOption('local-first')
    await save(page)
    await expect.poll(() => names(host)).toContain('ops_bash')
  })

  await info.attach('actual runner', {
    body: JSON.stringify({ platform: process.platform, arch: process.arch, layer: 'L2 isolated Harness web + Chromium; not Tauri L3' }),
    contentType: 'application/json',
  })
})
