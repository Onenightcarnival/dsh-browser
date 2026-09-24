#!/usr/bin/env node
/**
 * Desktop install artifacts → dist-desktop/
 *
 *   onenightcarnival-dsh-bridge-browser-<version>.tgz   `pnpm pack` of the bridge plugin
 *       install: desktop app → 配置中心 → 插件 → 「从 .tgz 安装」
 *                (= `dsh plugin --profile web add file:<path>`)
 *   dsh-browser-extension-chrome-<version>.zip          extensions/dsh-browser/dist, entries at the archive root
 *       install: chrome://extensions → Load unpacked → the unzipped folder
 *   SHA256SUMS.txt                                      covers both
 *
 * Input: `pnpm run build` output (`--build` runs it first).
 * <version>: the committed package version (scripts/version.mjs).
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

// 2. Chrome extension zip, named by the package version (the manifest drops
// prerelease labels) so zip and tgz share one version string.
const extensionPackage = JSON.parse(readFileSync(join(EXTENSION_DIR, 'package.json'), 'utf8'))
const zipName = `dsh-browser-extension-chrome-${extensionPackage.version}.zip`
zipDirectory(join(EXTENSION_DIR, 'dist'), join(OUT_DIR, zipName))

// 3. Checksums.
const lines = [tgz, zipName].map(name => `${sha256(join(OUT_DIR, name))}  ${name}`)
writeFileSync(join(OUT_DIR, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)

for (const name of [tgz, zipName, 'SHA256SUMS.txt']) {
  const size = statSync(join(OUT_DIR, name)).size
  console.log(`${name}\t${(size / 1024).toFixed(1)} KB`)
}
console.log(`\nArtifacts written to ${OUT_DIR}`)
