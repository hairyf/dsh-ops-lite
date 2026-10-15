import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SHELL_UPSTREAM_PINS } from '../../src/ops/shell-payloads.js'

// Test actual npm tarballs and a fresh CLI, never checkout assets or a user Harness.
async function main() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-ops-lite-e2e-')))
  const installation = path.join(root, 'installation')
  const home = path.join(root, 'home')
  const project = fileURLToPath(new URL('../../', import.meta.url))
  const version = '0.2.1-alpha.1'
  const targets = ['win32-x64', 'linux-x64', 'darwin-arm64']
  const target = `${process.platform}-${process.arch}`
  assert(targets.includes(target), `No npm runtime package is shipped for ${target}.`)
  const keepTemp = process.env.DSH_E2E_KEEP_TMP === '1' && !process.env.CI
  let tarball = process.env.DSH_E2E_TARBALL
  let platformTarball = process.env.DSH_E2E_PLATFORM_TARBALL
  const shellTarballs = { bash: process.env.DSH_E2E_BASH_TARBALL, pwsh: process.env.DSH_E2E_PWSH_TARBALL }
  const shellPins = process.platform === 'win32' ? SHELL_UPSTREAM_PINS : []
  assert.equal(Boolean(tarball), Boolean(platformTarball), 'Supply both DSH_E2E_TARBALL and DSH_E2E_PLATFORM_TARBALL, or pack the already-built workspace.')
  for (const pin of shellPins)
    assert.equal(Boolean(shellTarballs[pin.name]), Boolean(tarball), 'On Windows also supply DSH_E2E_BASH_TARBALL and DSH_E2E_PWSH_TARBALL, or pack all four packages locally.')
  console.warn(`Independent Harness test directory: ${root}`)
  const nodeDirectory = path.dirname(process.execPath)
  const npmCandidates = [
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ]
  const npmCli = (await Promise.all(npmCandidates.map(async candidate => access(candidate).then(() => candidate, () => undefined)))).find(Boolean)
  assert(npmCli, 'Node must include npm; no global Harness or package-manager fallback is allowed.')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DSH_|npm_config_(?:cache|userconfig)$)/i.test(key)))
  Object.assign(env, {
    DSH_E2E_ROOT: root,
    DSH_E2E_DSH_VERSION: version,
    DSH_HOME: path.join(root, 'dsh-home'),
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(root, 'browsers'),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(home, '.npmrc'),
    CARGO_HOME: path.join(root, 'cargo'),
    RUSTUP_HOME: path.join(root, 'rustup'),
  })
  const installEnv = { ...env }
  for (const key of Object.keys(installEnv)) {
    if (/^(?:path|npm_config_script_shell|VSINSTALLDIR|VCINSTALLDIR|VCToolsInstallDir|INCLUDE|LIB|LIBPATH|CARGO_TARGET_.*_LINKER|RUSTC|RUSTC_WRAPPER)$/i.test(key))
      delete installEnv[key]
  }
  installEnv.PATH = process.platform === 'win32' ? `${nodeDirectory}${path.delimiter}${path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32')}` : nodeDirectory
  installEnv.npm_config_script_shell = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/cmd.exe') : '/bin/sh'

  function run(argv, { capture = false, executable = process.execPath, childEnv = env, cwd = project } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, argv, { cwd, env: childEnv, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', detached: process.platform !== 'win32' })
      let output = ''
      let errors = ''
      child.stdout?.on('data', chunk => output += chunk.toString())
      child.stderr?.on('data', chunk => errors += chunk.toString())
      const stop = () => {
        if (process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('error', reject)
        else process.kill(-child.pid, 'SIGTERM')
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        if (code === 0)
          resolve(output)
        else reject(new Error(`${path.basename(executable)} ${argv[0]} failed (${signal ?? code})\n${errors}`))
      })
    })
  }
  const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')

  try {
    await mkdir(home, { recursive: true })
    if (!tarball) {
      const pnpm = process.env.npm_execpath
      assert(pnpm && /pnpm/i.test(pnpm), 'Use pnpm run test:e2e after building/staging the platform package, or supply both tarball paths.')
      const packages = path.join(root, 'packages')
      await mkdir(packages)
      for (const filter of [[], ['--filter', `@dshopslite/${target}`], ...shellPins.map(pin => ['--filter', pin.payloadPackage])]) {
        const args = [...filter, '--config.ignore-scripts=true', 'pack', '--pack-destination', packages]
        await run(/\.[cm]?js$/.test(pnpm) ? [pnpm, ...args] : args, { executable: /\.[cm]?js$/.test(pnpm) ? process.execPath : pnpm })
      }
      const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
      tarball = path.join(packages, `dsh-ops-lite-${manifest.version}.tgz`)
      platformTarball = path.join(packages, `dshopslite-${target}-${manifest.version}.tgz`)
      for (const pin of shellPins)
        shellTarballs[pin.name] = path.join(packages, `${pin.payloadPackage.slice(1).replace('/', '-')}-${pin.payloadVersion}.tgz`)
    }
    const inspected = []
    for (const [file, name, pin] of [[tarball, 'dsh-ops-lite'], [platformTarball, `@dshopslite/${target}`], ...shellPins.map(pin => [shellTarballs[pin.name], pin.payloadPackage, pin])]) {
      assert(path.isAbsolute(file) && file.endsWith('.tgz'), 'Require explicit absolute npm tarball paths.')
      await access(file)
      const [packed] = JSON.parse(await run([npmCli, 'pack', file, '--dry-run', '--ignore-scripts', '--json'], { capture: true }))
      assert.equal(packed.name, name)
      // Git Bash's tar treats a Windows drive letter as a remote host; use the native archive tool.
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar'
      const manifest = JSON.parse(await run(['-xOf', file, 'package/package.json'], { executable: tar, capture: true }))
      assert.equal(manifest.name, name)
      assert.equal(manifest.version, packed.version)
      if (process.platform !== 'win32' && name === `@dshopslite/${target}`) {
        const listing = (await run(['-tvf', file], { executable: tar, capture: true })).split('\n')
        for (const executable of ['dsh-ops-worker', 'fastctx']) {
          const entry = listing.find(line => line.endsWith(` package/runtime/${target}/${executable}`))
          assert(entry?.startsWith('-rwxr-xr-x'), `The platform tarball must retain mode 0755 for ${executable}: ${entry ?? 'missing'}`)
        }
      }
      for (const lifecycle of ['preinstall', 'install', 'postinstall'])
        assert.equal(manifest.scripts?.[lifecycle], name === 'dsh-ops-lite' && lifecycle === 'postinstall' ? 'node scripts/provision-shells.mjs --postinstall' : undefined, `${name} permits only the main package's shell-provisioning postinstall, never a compilation hook.`)
      assert.deepEqual(manifest.dependencies ?? {}, {}, `${name} must not add external runtime JavaScript dependencies.`)
      if (pin) {
        assert.equal(manifest.version, pin.payloadVersion)
        assert.deepEqual(manifest.os, ['win32'])
        assert.deepEqual(manifest.cpu, ['x64'])
        assert.deepEqual(manifest.optionalDependencies ?? {}, {})
        const payload = JSON.parse(await run(['-xOf', file, 'package/payload.json'], { executable: tar, capture: true }))
        const executable = `vendor/${pin.name}/win32-x64/${pin.name === 'bash' ? 'bin/bash.exe' : 'pwsh.exe'}`
        assert.deepEqual(payload, { kind: pin.name, target: 'win32-x64', version: pin.payloadVersion, executable, sha256: pin.executableSha256 })
        const payloadFiles = packed.files.map(file => file.path)
        assert(payloadFiles.includes(executable), `${name} must include its real executable.`)
        assert(payloadFiles.some(file => file.startsWith('licenses/')), `${name} must retain its licenses.`)
        assert(!payloadFiles.some(file => !['package.json', 'payload.json', 'README.md', 'LICENSE'].includes(file) && !file.startsWith('licenses/') && !file.startsWith(`vendor/${pin.name}/win32-x64/`)), `${name} must contain only its own shell payload and metadata.`)
      }
      inspected.push({ ...packed, manifest, tarballSha256: await sha256(file) })
    }
    const [packed, platformPacked] = inspected
    assert.equal(platformPacked.version, packed.version)
    assert.deepEqual(platformPacked.manifest.os, [process.platform])
    assert.deepEqual(platformPacked.manifest.cpu, [process.arch])
    assert.deepEqual(packed.manifest.optionalDependencies, Object.fromEntries(targets.map(target => [`@dshopslite/${target}`, packed.version])))
    assert.deepEqual(Object.keys(packed.manifest.bin), ['dsh-ops-provision-shells'])
    assert.equal(packed.manifest.bin['dsh-ops-provision-shells'].replace(/^\.\//, ''), 'scripts/provision-shells.mjs')
    const files = packed.files.map(file => file.path)
    const installerFiles = ['scripts/provision-shells.mjs', 'src/ops/shell-payloads.js', 'src/ops/provision.js']
    assert(!files.some(file => !installerFiles.includes(file) && (/^(?:build\/|dist\/(?:runtime|vendor|licenses)(?:\/|$)|\.cache\/|node_modules\/|native\/|vendor\/|src\/|scripts\/|bin\/)|\/(?:target|node_modules)\//.test(file) || file === 'runtime-manifest.json')), 'The main package permits only the explicit provisioning sources, never native payloads, other installers, source-build inputs or caches.')
    for (const required of ['dist/index.js', 'dist/client.js', 'dist/shell.js', 'dist/background.js', 'dist/ptc.js', 'dist/prepare-workspace.ps1', 'cordis.patch.yml', ...installerFiles])
      assert(files.includes(required), `Main package is missing ${required}`)
    const platformFiles = platformPacked.files.map(file => file.path)
    assert(platformFiles.some(file => file.startsWith('licenses/')), 'Platform package must retain its runtime licenses.')
    assert(!platformFiles.some(file => /^(?:src|native|build|node_modules|scripts|vendor)\//.test(file)), 'Platform package must not contain shell vendors, installers or source-build inputs.')
    for (const other of targets.filter(other => other !== target))
      assert(!platformFiles.some(file => file.startsWith(`runtime/${other}/`) || file.startsWith(`vendor/bash/${other}/`) || file.startsWith(`vendor/pwsh/${other}/`)), 'Package only this runner\'s actual OS/CPU assets.')
    console.warn(`Main package: ${packed.filename}, ${packed.size} bytes, SHA256 ${packed.tarballSha256}`)
    console.warn(`Platform package: ${platformPacked.filename}, ${platformPacked.size} bytes, SHA256 ${platformPacked.tarballSha256}`)

    await run([npmCli, 'install', '--prefix', installation, '--no-audit', '--no-fund', '--ignore-scripts', '--omit=dev', `@deepseek-ai/dsh@${version}`])
    const cli = path.join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    await access(cli)
    const manifest = JSON.parse(await readFile(path.join(installation, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
    assert.equal(manifest.version, version)
    assert((await realpath(cli)).startsWith(`${await realpath(installation)}${path.sep}`))
    env.DSH_E2E_DSH_BIN = cli
    for (const tool of ['cargo', 'rustc', 'cl', 'link']) {
      await new Promise((resolve, reject) => {
        const probe = spawn(tool, ['--version'], { env: installEnv, stdio: 'ignore', windowsHide: true })
        probe.once('error', error => error.code === 'ENOENT' ? resolve() : reject(error))
        probe.once('exit', () => reject(new Error(`The isolated installation unexpectedly has ${tool} available.`)))
      })
    }
    for (const [option, incompatible] of [['os', process.platform === 'linux' ? 'darwin' : 'linux'], ['cpu', process.arch === 'x64' ? 'arm64' : 'x64']]) {
      const prefix = path.join(root, `incompatible-${option}`)
      await mkdir(prefix)
      await writeFile(path.join(prefix, 'package.json'), JSON.stringify({ private: true, optionalDependencies: { [platformPacked.name]: `file:${platformTarball}` } }))
      await run([npmCli, 'install', '--prefix', prefix, '--no-audit', '--no-fund', '--ignore-scripts', '--omit=dev', `--${option}=${incompatible}`], { capture: true, childEnv: installEnv })
      await assert.rejects(access(path.join(prefix, 'node_modules', platformPacked.name)), { code: 'ENOENT' }, `npm must omit the optional platform package for an incompatible ${option}.`)
    }
    console.warn('Installing the platform and main tarballs with no lifecycle scripts or Rust/MSVC tools on PATH.')
    await run([npmCli, 'install', '--prefix', installation, '--no-audit', '--no-fund', '--omit=dev', '--ignore-scripts', platformTarball, tarball], { childEnv: installEnv })
    const plugin = path.join(installation, 'node_modules/dsh-ops-lite')
    assert.equal(await realpath(plugin), plugin, 'The tested plugin must be installed, not a checkout link.')
    const installed = JSON.parse(await readFile(path.join(plugin, 'package.json'), 'utf8'))
    assert.deepEqual(installed, packed.manifest, 'Install the exact inspected main tarball.')
    const platformRoot = path.dirname(createRequire(path.join(plugin, 'package.json')).resolve(`@dshopslite/${target}/package.json`))
    assert.equal(await realpath(platformRoot), path.join(installation, `node_modules/@dshopslite/${target}`), 'Execute assets directly from the installed platform package.')
    assert.deepEqual(JSON.parse(await readFile(path.join(platformRoot, 'package.json'), 'utf8')), platformPacked.manifest)
    await assert.rejects(access(path.join(plugin, 'dist/runtime')), { code: 'ENOENT' }, 'Do not copy platform payloads into the main package.')
    for (const other of targets.filter(other => other !== target))
      await assert.rejects(access(path.join(installation, `node_modules/@dshopslite/${other}`)), { code: 'ENOENT' }, 'npm must not install another OS/CPU runtime package.')
    const evidence = { tarball: packed.filename, tarballSha256: packed.tarballSha256, packageBytes: packed.size, platformTarball: platformPacked.filename, platformTarballSha256: platformPacked.tarballSha256, platformPackageBytes: platformPacked.size, target, version: installed.version, compilerToolsAvailable: false, npmOsCpuFilteringVerified: true, platformRoot, runtimes: [] }
    for (const [name, receiptName, binaryVersion] of [['dsh-ops-worker', 'provenance.json', installed.version], ['fastctx', 'fastctx.provenance.json', '0.2.6']]) {
      const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`
      const runtime = path.join(platformRoot, 'runtime', target)
      const receipt = JSON.parse(await readFile(path.join(runtime, receiptName), 'utf8'))
      assert.equal(receipt.target, target)
      assert.equal(receipt.version, binaryVersion)
      assert.equal(receipt.executable, executable)
      assert.equal(receipt.sha256, await sha256(path.join(runtime, executable)))
      const output = (await run(['--version'], { executable: path.join(runtime, executable), capture: true, childEnv: installEnv })).trim()
      assert.equal(output, `${name} ${binaryVersion}`)
      evidence.runtimes.push({ ...receipt, versionOutput: output })
      console.warn(`Installed ${target}: ${output}; SHA256 ${receipt.sha256}`)
    }
    if (shellPins.length) {
      const payloads = await import(pathToFileURL(path.join(plugin, 'src/ops/shell-payloads.js')).href)
      assert.deepEqual(payloads.SHELL_UPSTREAM_PINS, SHELL_UPSTREAM_PINS, 'Test the installed shared pins, not a checkout runtime.')
      const requests = []
      let registryUrl
      const registry = createServer((request, response) => {
        const route = (request.url ?? '').replace(/%2f/gi, '/')
        requests.push(`${request.method} ${route}`)
        const pin = shellPins.find(pin => route === `/${pin.payloadPackage}` || route === `/${pin.name}.tgz`)
        if (request.method !== 'GET' || !pin) {
          response.writeHead(404).end()
          return
        }
        if (route === `/${pin.name}.tgz`) {
          response.setHeader('content-type', 'application/octet-stream')
          createReadStream(shellTarballs[pin.name]).on('error', error => response.destroy(error)).pipe(response)
          return
        }
        const packed = inspected.find(packed => packed.name === pin.payloadPackage)
        const metadata = { ...packed.manifest, dist: { tarball: `${registryUrl}/${pin.name}.tgz`, integrity: packed.integrity } }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ 'name': pin.payloadPackage, 'dist-tags': { latest: pin.payloadVersion }, 'versions': { [pin.payloadVersion]: metadata } }))
      })
      await new Promise((resolve, reject) => {
        registry.once('error', reject)
        registry.listen(0, '127.0.0.1', resolve)
      })
      const address = registry.address()
      assert(address && typeof address === 'object')
      registryUrl = `http://127.0.0.1:${address.port}`
      console.warn('Running the installed main postinstall against a test-owned registry, with no checkout dependencies or compiler tools.')
      const provisionEnv = { ...installEnv, DSH_OPS_FORCE_MANAGED_SHELLS: '1', npm_config_registry: registryUrl, npm_config_cache: path.join(root, 'provision-npm-cache'), npm_config_offline: 'false' }
      try {
        for (const pin of shellPins) {
          await assert.rejects(access(payloads.managedShellDirectory({ kind: pin.name, env: provisionEnv })), { code: 'ENOENT' }, 'The installer must fetch into a fresh managed store, not adopt preseeded payloads.')
          assert.equal(payloads.managedShell({ kind: pin.name, env: provisionEnv }), undefined)
        }
        await run([npmCli, 'run', 'postinstall', '--ignore-scripts=false', '--workspaces=false'], { childEnv: provisionEnv, cwd: plugin })
        for (const pin of shellPins) {
          assert(requests.includes(`GET /${pin.payloadPackage}`), `npm must fetch exact ${pin.payloadPackage} metadata.`)
          assert(requests.includes(`GET /${pin.name}.tgz`), `npm must fetch the inspected ${pin.name} tarball.`)
          assert.equal(payloads.managedShell({ kind: pin.name, env: provisionEnv })?.source, 'provisioned', 'The postinstall itself must finish verified provisioning before manual repair runs.')
        }
        const fetched = [...requests]
        // Repair must reuse the freshly installed generations without any HTTP, even offline.
        await run([path.join(plugin, installed.bin['dsh-ops-provision-shells'])], { childEnv: { ...provisionEnv, npm_config_offline: 'true' }, cwd: home })
        assert.deepEqual(requests, fetched, 'Offline manual repair must not make registry requests.')
        evidence.shellRegistryRequests = fetched
        evidence.offlineShellRepairReused = true
      }
      finally {
        await new Promise((resolve, reject) => registry.close(error => error ? reject(error) : resolve()))
      }
      evidence.shells = []
      for (const pin of shellPins) {
        const directory = payloads.managedShellDirectory({ kind: pin.name, env: installEnv })
        const payloadRoot = path.join(directory, 'node_modules', pin.payloadPackage)
        const shellPacked = inspected.find(packed => packed.name === pin.payloadPackage)
        assert.deepEqual(JSON.parse(await readFile(path.join(payloadRoot, 'package.json'), 'utf8')), shellPacked.manifest, 'The real installer must install the exact inspected shell tarball.')
        assert.equal(await realpath(payloadRoot), payloadRoot, 'Shell payloads must be npm-installed, not checkout links.')
        const receipt = JSON.parse(await readFile(path.join(directory, '.provisioned.json'), 'utf8'))
        assert.deepEqual(receipt, { kind: pin.name, target, version: pin.payloadVersion, source: 'payload', sha256: pin.executableSha256 })
        const resolved = payloads.managedShell({ kind: pin.name, env: installEnv })
        assert.equal(resolved?.source, 'provisioned', 'Both installed shells must resolve from the verified managed store, never a system installation.')
        assert.equal(await sha256(resolved.file), pin.executableSha256)
        const output = (await run(['--version'], { executable: resolved.file, capture: true, childEnv: installEnv, cwd: home })).trim()
        if (pin.name === 'bash')
          assert.match(output, /^GNU bash, version \d+\.\d+/)
        else assert.equal(output, `PowerShell ${pin.version}`)
        evidence.shells.push({ ...receipt, resolutionSource: resolved.source, executable: resolved.file, tarball: shellPacked.filename, tarballSha256: shellPacked.tarballSha256, packageBytes: shellPacked.size, versionOutput: output })
        console.warn(`Provisioned ${pin.name}: ${output.split('\n')[0]}; SHA256 ${receipt.sha256}`)
      }
      env.DSH_E2E_SHELL_STORE = payloads.shellStoreRoot({ env: installEnv })
    }
    env.DSH_E2E_PLUGIN_ROOT = plugin
    const report = path.join(project, 'test-results/e2e-installation.json')
    await mkdir(path.dirname(report), { recursive: true })
    await writeFile(report, `${JSON.stringify(evidence, null, 2)}\n`)
    const playwright = fileURLToPath(import.meta.resolve('@playwright/test/cli'))
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH)
      await run([playwright, 'install', 'chromium'])
    await run([playwright, 'test', '--config', 'playwright.config.ts', ...process.argv.slice(2)])
  }
  finally {
    assert.equal(path.dirname(root), await realpath(tmpdir()), 'Refuse to remove a non-test directory.')
    assert(path.basename(root).startsWith('dsh-ops-lite-e2e-'))
    if (keepTemp)
      console.warn(`Kept only this test-owned directory for debugging: ${root}`)
    else await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
