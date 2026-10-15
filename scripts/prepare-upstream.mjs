import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
export const NATIVE_TARGETS = Object.freeze({
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
})

/** Fail on upstream drift instead of publishing a partially patched runtime. */
export function replaceOnce(text, before, after, file) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before))
    throw new Error(`Upstream patch no longer matches exactly once: ${file}`)
  return text.replace(before, after)
}

export function prepareUpstream(root = PROJECT_ROOT) {
  const source = path.join(root, 'source/dsh-ops')
  const destination = path.join(root, 'dist/upstream')
  const patched = new Map()
  const patch = (file, replacements) => {
    let text = fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n')
    for (const [before, after] of replacements)
      text = replaceOnce(text, before, after, file)
    patched.set(file, text)
  }
  patch('lib/index.js', [
    ['import { mountConfigUpdates, updatedConfig } from \'./config-updates.js\'', 'import { updatedConfig } from \'./config-updates.js\''],
    ['export function applyComponent(root, rawConfig, component) {', 'export function applyComponent(root, rawConfig, component, options = {}) {'],
    ['  mountConfigUpdates(root, rawConfig)\n', ''],
    ['  const shells = component === \'shell\' ? resolveShells(config) : undefined', '  const shells = component === \'shell\' ? (options.shells ?? resolveShells(config)) : undefined'],
    ['  ctx.effect(() => () => { void surface.stop() }, \'dsh-ops: native file worker\')', '  ctx.effect(() => () => surface.stop(), \'dsh-ops: native file worker\')'],
  ])
  patch('lib/file/runtime.js', [
    ['    this.active = new Set()', '    this.active = new Map()'],
    ['    this.active.add(controller)', '    const completion = Promise.withResolvers()\n    this.active.set(controller, completion.promise)'],
    ['      exec?.signal?.removeEventListener?.(\'abort\', abort)', '      exec?.signal?.removeEventListener?.(\'abort\', abort)\n      completion.resolve()'],
    ['for (const controller of this.active)', 'for (const controller of this.active.keys())'],
    ['await Promise.allSettled([...this.active])', 'await Promise.allSettled(this.active.values())'],
  ])
  patch('lib/ptc/runtime.js', [
    ['export const PLATFORMS = Object.freeze([\'win32-x64\'])', `export const PLATFORMS = Object.freeze(${JSON.stringify(Object.keys(NATIVE_TARGETS))})`],
    // Literal template expressions belong to the copied JS source, not this script.
    // eslint-disable-next-line no-template-curly-in-string
    ['dsh-ops 0.3.0 supports Windows x64 only; unsupported runtime target ${platform}-${arch}.', 'Unsupported native runtime target ${platform}-${arch}; supported targets: ${PLATFORMS.join(\', \')}.'],
  ])
  patch('lib/shells.js', ['fromPath', 'isWslBashLauncher', 'wellKnownCandidates', 'executableNames'].map(name => [
    `function ${name}(`,
    `export function ${name}(`,
  ]))
  patch('bin/build-bash-ipc.mjs', [
    ['const source=path.join(root,\'node_modules/@dsh-ops/bash-win32-x64/usr/bin/msys-2.0.dll\')', 'const source=process.env.DSH_OPS_MSYS_DLL ?? path.join(root,\'node_modules/@dsh-ops/bash-win32-x64/usr/bin/msys-2.0.dll\')'],
  ])

  // These are build-owned trees only; never remove managed/local runtime installs.
  for (const directory of ['lib', 'bin', 'native/bash-ipc', 'vendor/fastctx'])
    fs.rmSync(path.join(destination, directory), { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  const copy = (file) => {
    const target = path.join(destination, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(path.join(source, file), target, { recursive: true })
  }
  for (const file of ['lib', 'LICENSE', 'NOTICE', 'native/bash-ipc', 'bin/dsh-ops.mjs', 'bin/native-runtime.mjs', 'bin/build-bash-ipc.mjs', 'bin/prepare-workspace.ps1'])
    copy(file)
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  // This nested manifest identifies copied source; it must not provision payloads.
  for (const field of ['optionalDependencies', 'os', 'cpu', 'scripts'])
    delete manifest[field]
  fs.writeFileSync(path.join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // Source-only opt-in FastCtx builds: no target/, Pdfium, or shell payloads.
  for (const file of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'src', 'README.md', 'LICENSE-APACHE', 'NOTICE', 'UPSTREAM.md', 'FORK.md', 'THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_LICENSES_RUST.md'])
    copy(`vendor/fastctx/${file}`)
  if (fs.existsSync(path.join(source, 'vendor/fastctx/third-party')))
    copy('vendor/fastctx/third-party')
  for (const [file, text] of patched)
    fs.writeFileSync(path.join(destination, file), text)
  return destination
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(`Prepared upstream runtime: ${prepareUpstream()}`)
