import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { patchMsys } from '../source/dsh-ops/lib/bash-pe.js'
import { prepareUpstream, PROJECT_ROOT } from './prepare-upstream.mjs'

/** Explicit input only: never discover, download, or alter the installed shell. */
export function buildBashIpc({ bashRoot, root = PROJECT_ROOT } = {}) {
  if (typeof bashRoot !== 'string' || !path.isAbsolute(bashRoot))
    throw new Error('--bash-root must be an absolute MSYS/PortableGit installation root.')
  const source = path.join(bashRoot, 'usr/bin/msys-2.0.dll')
  for (const file of [source, path.join(bashRoot, 'usr/bin/bash.exe')]) {
    if (!fs.statSync(file).isFile())
      throw new Error(`Expected a regular MSYS file: ${file}`)
  }
  patchMsys(fs.readFileSync(source))
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Build the Bash IPC proxies on Windows x64 with MSVC/Windows SDK.')
  const upstream = prepareUpstream(root)
  const result = spawnSync(process.execPath, [path.join(upstream, 'bin/build-bash-ipc.mjs')], {
    cwd: upstream,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, DSH_OPS_MSYS_DLL: source },
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Bash IPC build failed (${result.signal ?? result.status}).`)
  return path.join(upstream, 'runtime/win32-x64/bash-ipc')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'bash-root': { type: 'string' } } })
  console.log(`Built Bash IPC proxies: ${buildBashIpc({ bashRoot: values['bash-root'] })}`)
}
