#!/usr/bin/env node
/**
 * One version for every published surface of the workspace.
 *
 *   node scripts/version.mjs set 0.2.0     write it to every file below
 *   node scripts/version.mjs check 0.2.0   exit 1 unless every file already carries it
 *
 * Files:
 *   package.json                                    workspace root
 *   packages/browser/bridge-browser/package.json    bridge plugin: .tgz name, plugin-manager version
 *   extensions/dsh-browser/package.json             extension package: .zip name
 *   extensions/dsh-browser/manifest.json            Chrome manifest, numeric part only
 *   extensions/dsh-browser/manifest.firefox.json    Firefox manifest, numeric part only
 *
 * Release: `set` → commit → tag v<version> → push; the release workflow runs `check` against the tag.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const FIELD_RE = /^(\s*"version":\s*)"([^"]*)"/m

/** Browser manifests reject prerelease labels, so they take the numeric part only. */
const FILES = [
  { path: 'package.json', numericOnly: false },
  { path: 'packages/browser/bridge-browser/package.json', numericOnly: false },
  { path: 'extensions/dsh-browser/package.json', numericOnly: false },
  { path: 'extensions/dsh-browser/manifest.json', numericOnly: true },
  { path: 'extensions/dsh-browser/manifest.firefox.json', numericOnly: true },
]

const [command, version] = process.argv.slice(2)
if (command !== 'set' && command !== 'check') {
  console.error('usage: node scripts/version.mjs <set|check> <X.Y.Z[-prerelease]>')
  process.exit(1)
}
if (version === undefined || !VERSION_RE.test(version)) {
  console.error(`invalid version ${JSON.stringify(version ?? '')}: expected X.Y.Z or X.Y.Z-prerelease`)
  process.exit(1)
}

let mismatches = 0
for (const file of FILES) {
  const target = join(ROOT, file.path)
  const text = readFileSync(target, 'utf8')
  const match = FIELD_RE.exec(text)
  if (match === null) throw new Error(`${file.path}: no version field`)
  const expected = file.numericOnly ? version.replace(/-.*$/, '') : version
  if (command === 'set') {
    writeFileSync(target, text.replace(FIELD_RE, `$1"${expected}"`))
    console.log(`${file.path}: ${expected}`)
  } else if (match[2] === expected) {
    console.log(`${file.path}: ${expected}`)
  } else {
    console.error(`${file.path}: ${match[2]} (expected ${expected})`)
    mismatches++
  }
}

if (mismatches > 0) {
  console.error(`\n${mismatches} file(s) do not carry ${version}; run: node scripts/version.mjs set ${version}`)
  process.exit(1)
}
