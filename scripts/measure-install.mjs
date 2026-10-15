import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Explicit inspection only: npm lifecycle scripts never run; all writes are test-owned.
const [spec, ...extra] = process.argv.slice(2)
assert(spec && !extra.length && !spec.startsWith('-'), 'Usage: node scripts/measure-install.mjs <npm-package-spec-or-tarball>')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-size-'))
try {
  const nodeDirectory = path.dirname(process.execPath)
  const npm = [
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find(file => fs.existsSync(file))
  assert(npm, 'Node must include npm')
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/i.test(key) && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key)))
  Object.assign(env, { HOME: home, USERPROFILE: home, npm_config_cache: path.join(root, 'npm-cache') })
  const result = spawnSync(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', spec], {
    env,
    stdio: ['ignore', 2, 2],
  })
  if (result.error)
    throw result.error
  assert.equal(result.status, 0, 'Isolated npm installation failed')
  function size(directory) {
    let bytes = 0
    let files = 0
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name)
      if (item.isDirectory()) {
        const nested = size(file)
        bytes += nested.bytes
        files += nested.files
      }
      else if (item.isFile()) {
        bytes += fs.statSync(file).size
        files++
      }
    }
    return { bytes, files }
  }
  const packages = {}
  const modules = path.join(root, 'node_modules')
  for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue
    const names = entry.name.startsWith('@')
      ? fs.readdirSync(path.join(modules, entry.name)).map(name => `${entry.name}/${name}`)
      : [entry.name]
    for (const name of names) {
      const directory = path.join(modules, name)
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
      packages[name] = { version: manifest.version, ...size(directory) }
    }
  }
  assert(Object.keys(packages).length, 'The installation must contain a real package, not a symlink')
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    spec,
    metric: 'sum of regular-file logical bytes; excludes npm cache, directory/NTFS allocation, links and lockfiles',
    packages,
    totalPackageBytes: Object.values(packages).reduce((total, value) => total + value.bytes, 0),
  }, null, 2))
}
finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
  assert(path.basename(root).startsWith('dsh-ops-size-'))
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
