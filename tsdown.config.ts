import type { UserConfig } from 'tsdown'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'tsdown'
import { StaleGuardRecorder } from 'tsdown-stale-guard'
import { buildRuntime } from './build/runtime.mjs'

export const dshExternal = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  /^@deepseek-ai\//,
]

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { name: string }
const id = JSON.stringify(pkg.name)

const common: UserConfig = {
  outDir: 'dist',
  format: 'esm',
  outExtensions: () => ({ js: '.js' }),
  publint: true,
  deps: { neverBundle: dshExternal },
  // ponytail: freshness covers sources/config; runtime receipts verify payloads.
  // Enable output hashing when stale-guard bounds its parallel file reads.
  plugins: [StaleGuardRecorder({ hashOutputs: false })],
}

export default defineConfig([
  {
    ...common,
    entry: { index: 'src/index.ts', shell: 'src/shell.ts', background: 'src/background.ts', ptc: 'src/ptc.ts' },
    copy: [{ from: 'src/components', to: 'dist' }],
    hooks: { 'build:done': async () => { await buildRuntime() } },
    dts: true,
    sourcemap: false,
    // Rebuild JS without deleting this installation's native runtime.
    clean: ['dist/*.{js,map,ts}', 'dist/components'],
  },
  {
    ...common,
    entry: { client: 'src/client/index.ts' },
    // Client bundles are classic scripts consumed by dsh-client-modules.
    // CJS output is required so its exports remain inside the loader factory.
    format: 'cjs',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    banner: `window.__ModuleLoader__.load({id:${id},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
    footer: 'return module.exports;}});',
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
  },
])
