import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { defineConfig } from 'bumpp'

export function syncNativeVersion(root = process.cwd()) {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?(?:\+[0-9A-Z.-]+)?$/i.test(version))
    throw new Error('Package version must be a semantic version before synchronizing the native crate.')
  const updates = ['Cargo.toml', 'Cargo.lock'].map((name) => {
    const file = path.join(root, 'native', name)
    const text = readFileSync(file, 'utf8')
    const matches = [...text.matchAll(/(^name = "dsh-ops-core"\r?\nversion = ")[^"\r\n]+"/gm)]
    if (matches.length !== 1)
      throw new Error(`Expected exactly one dsh-ops-core version in ${file}.`)
    return { file, text: text.replace(matches[0][0], `${matches[0][1]}${version}"`) }
  })
  for (const { file, text } of updates) writeFileSync(file, text)
}

export default defineConfig({
  files: ['package.json', 'packages/*/package.json'],
  all: true,
  execute({ options: { cwd, commit } }) {
    const pnpm = process.env.npm_execpath
    if (!pnpm)
      throw new Error('Run releases with pnpm release.')
    syncNativeVersion(cwd)
    const pnpmCommand = /\.[cm]?js$/.test(pnpm) ? [process.execPath, pnpm] : [pnpm]
    const commands = [
      [...pnpmCommand, 'install', '--lockfile-only', '--ignore-scripts'],
      [...pnpmCommand, 'run', 'build'],
      ...(commit ? [['git', 'add', '--', 'dist']] : []),
    ]
    for (const [command, ...args] of commands) {
      const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
      if (result.error)
        throw result.error
      if (result.status !== 0)
        throw new Error(`Release preparation failed (${result.signal ?? result.status}).`)
    }
  },
})
