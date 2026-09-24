#!/usr/bin/env node
/**
 * Stamp one version onto every published surface of this workspace: the
 * bridge plugin package, the extension package and both extension manifests
 * (Chrome + Firefox), plus the workspace root for reference. The release
 * workflow runs this with the pushed tag so artifacts always carry the tag's
 * version regardless of what is committed.
 *
 *   node scripts/set-version.mjs 0.2.0
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/set-version.mjs <X.Y.Z[-prerelease]>')
  process.exit(1)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = [
  'package.json',
  'packages/browser/bridge-browser/package.json',
  'extensions/dsh-browser/package.json',
  'extensions/dsh-browser/manifest.json',
  'extensions/dsh-browser/manifest.firefox.json',
]

for (const relative of FILES) {
  const file = join(ROOT, relative)
  const text = readFileSync(file, 'utf8')
  // Chrome manifests must be X.Y.Z (up to four dot-separated integers); strip
  // any prerelease label there and keep the full string everywhere else.
  const value = relative.endsWith('manifest.json') || relative.endsWith('manifest.firefox.json')
    ? version.replace(/-.*$/, '')
    : version
  const updated = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${value}"`)
  if (updated === text) throw new Error(`${relative}: no version field found`)
  writeFileSync(file, updated)
  console.log(`${relative}: ${value}`)
}
