#!/usr/bin/env node
/**
 * Produce the two artifacts DeepSeek Harness Desktop users install by hand:
 *
 *   dist-desktop/onenightcarnival-dsh-bridge-browser-<ver>.tgz
 *       `pnpm pack` of the bridge plugin. Install it from the desktop app's
 *       配置中心 → 插件 → 「从 .tgz 安装」 (which runs
 *       `dsh plugin --profile web add file:<path>` under the hood).
 *
 *   dist-desktop/dsh-browser-extension-chrome-<ver>.zip
 *       The built Chrome extension. Unzip it anywhere and load that folder
 *       as an unpacked extension at chrome://extensions.
 *
 * plus SHA256SUMS.txt covering both. Run `pnpm run build` first (or let this
 * script do it with --build). The release workflow uploads the same files.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE_DIR = join(ROOT, 'packages', 'browser', 'bridge-browser')
const EXTENSION_DIR = join(ROOT, 'extensions', 'dsh-browser')
const OUT_DIR = join(ROOT, 'dist-desktop')

const args = new Set(process.argv.slice(2))

function run(cmd, cmdArgs, cwd) {
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed with status ${String(result.status)}`)
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Zip a directory so its entries are rooted at the archive top level. */
function zipDirectory(dir, target) {
  rmSync(target, { force: true })
  if (process.platform === 'win32') {
    const ps = `Compress-Archive -Path ${JSON.stringify(join(dir, '*'))} -DestinationPath ${JSON.stringify(target)} -Force`
    run('powershell', ['-NoProfile', '-Command', ps], dir)
    return
  }
  run('zip', ['-qr', target, '.'], dir)
}

if (args.has('--build')) run('pnpm', ['run', 'build'], ROOT)

const bridgeLib = join(BRIDGE_DIR, 'lib', 'index.js')
const extensionManifest = join(EXTENSION_DIR, 'dist', 'manifest.json')
if (!existsSync(bridgeLib) || !existsSync(extensionManifest)) {
  console.error('package-desktop: build output missing; run `pnpm run build` first or pass --build')
  process.exit(1)
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

// 1. Bridge plugin tarball (npm pack semantics: only `files` entries ship).
execFileSync('pnpm', ['pack', '--pack-destination', OUT_DIR], { cwd: BRIDGE_DIR, stdio: 'inherit', shell: process.platform === 'win32' })
const tgz = readdirSync(OUT_DIR).find(name => name.endsWith('.tgz'))
if (tgz === undefined) throw new Error('package-desktop: pnpm pack produced no tarball')

// 2. Chrome extension zip.
const manifest = JSON.parse(readFileSync(extensionManifest, 'utf8'))
const zipName = `dsh-browser-extension-chrome-${manifest.version}.zip`
zipDirectory(join(EXTENSION_DIR, 'dist'), join(OUT_DIR, zipName))

// 3. Checksums.
const lines = [tgz, zipName].map(name => `${sha256(join(OUT_DIR, name))}  ${name}`)
writeFileSync(join(OUT_DIR, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)

for (const name of [tgz, zipName, 'SHA256SUMS.txt']) {
  const size = statSync(join(OUT_DIR, name)).size
  console.log(`${name}\t${(size / 1024).toFixed(1)} KB`)
}
console.log(`\nArtifacts written to ${OUT_DIR}`)
