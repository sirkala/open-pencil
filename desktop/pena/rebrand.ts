// Renames the product from OpenPencil to Pena in what people read: the app's text and its
// translations, page titles, menus, error messages, AI prompts, and the documentation site.
// Package names (`@open-pencil/*`), identifiers, comments, license and copyright lines, and values
// stored inside documents keep upstream's spelling, so upstream merges stay small.
//
// Rerun it after every upstream merge; it only rewrites what is still spelled the old way. When a
// merge conflicts only over branding, take upstream's side of the file and run this again.
// Usage: bun desktop/pena/rebrand.ts [--check]
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const OLD = 'OpenPencil'
const NEW = 'Pena'
// A hyphen before the name makes it part of a header such as `X-OpenPencil-…`.
const WORD = /(?<![A-Za-z0-9_$-])OpenPencil(?![A-Za-z0-9_$])/g

const root = resolve(import.meta.dir, '../..')
const check = process.argv.includes('--check')

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.mjs',
  '.vue',
  '.json',
  '.html',
  '.md',
  '.yml',
  '.yaml',
  '.rs',
  '.plist',
  '.svg',
  '.css'
])
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.vue', '.rs', '.css'])

/** Paths that keep upstream's spelling: attribution, history, packaging, and recorded data. */
const SKIPPED_PATHS: RegExp[] = [
  // Attribution and licensing stay OpenPencil's.
  /^LICENSE/,
  /^LICENSES\//,
  /^REUSE\.toml$/,
  /^NOTICE\.md$/,
  /^FORK\.md$/,
  // Release history and pending upstream release notes.
  /^CHANGELOG\.md$/,
  /^changes\//,
  /(^|\/)CHANGELOG\.md$/,
  // Contributor guides and npm package READMEs describe the shared upstream code.
  /(^|\/)AGENTS\.md$/,
  /^CONTRIBUTING\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  /^packages\/fig\/docs\//,
  /(^|\/)package\.json$/,
  /^bun\.lock$/,
  // Repository tooling, release asset names, and the agent skill named after the packages.
  /^tools\//,
  /^\.github\/workflows\//,
  /^skills\//,
  // Native packaging: the base Tauri app stays upstream's; `desktop/pena/` is the Pena build.
  /^desktop\/(capabilities|pena)\//,
  /^desktop\/Cargo\.(toml|lock)$/,
  /^desktop\/tauri\.conf\.json$/,
  // Recorded oracles and sample content used as test data.
  /^tests\/fixtures\//,
  /^packages\/dom-css\/tests\/(helpers\.ts|import\/|runtime\.test\.ts)/,
  /^packages\/kiwi\/tests\//,
  /^tests\/e2e\/(dom-css|fonts)\//,
  // Brand artwork belongs to the brand generator.
  /^assets\/brand\//,
  /\/brand\//
]

/** Lines whose OpenPencil is a value other software or saved files rely on. */
const PROTECTED_LINES: RegExp[] = [
  /OpenPencil (Section Title|Emoji Metrics|library definitions)/,
  /host="OpenPencil"/,
  /HOST = 'OpenPencil'/,
  /"app":\s*"OpenPencil"/,
  /trackGroup: 'OpenPencil'/,
  /DIR_NAME_MACOS/,
  /MCP_RUNTIME_FOLDER \?\? 'OpenPencil'/,
  /Application Support\/OpenPencil/,
  /'Application Support', 'OpenPencil'/,
  /OpenPencil contributors/,
  // Pena's own words about where it comes from.
  /the OpenPencil project/,
  /OpenPencil-(\d|Chromium)/,
  // The base app's binary and process name, set in `desktop/Cargo.toml`.
  /OpenPencil\.exe/,
  /Get-Process OpenPencil/
]

function isComment(line: string, extension: string): boolean {
  const text = line.trimStart()
  if (text.startsWith('<!--')) return true
  if (CODE_EXTENSIONS.has(extension)) {
    return text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')
  }
  if (extension === '.yml' || extension === '.yaml') return text.startsWith('#')
  return false
}

function rebrandLine(line: string): string {
  return (
    line
      .replace(WORD, NEW)
      // English articles before the new name.
      .replace(/\b([Aa])n Pena\b/g, '$1 Pena')
      // French and Italian elision before a consonant.
      .replace(/\b([dD])[’']Pena\b/g, '$1e Pena')
      .replace(/\b([lL])[’']Pena\b/g, 'Pena')
      .replace(/\bqu[’']Pena\b/g, 'que Pena')
      .replace(/\bdell[’']Pena\b/g, 'di Pena')
      .replace(/\bnell[’']Pena\b/g, 'in Pena')
      .replace(/\ball[’']Pena\b/g, 'a Pena')
  )
}

function rebrand(text: string, extension: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.includes(OLD)) return line
      if (isComment(line, extension)) return line
      if (PROTECTED_LINES.some((pattern) => pattern.test(line))) return line
      return rebrandLine(line)
    })
    .join('\n')
}

const listed = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root })
if (listed.exitCode !== 0) throw new Error(listed.stderr.toString())
const paths = listed.stdout
  .toString()
  .split('\0')
  .filter(
    (path) =>
      path !== '' &&
      TEXT_EXTENSIONS.has(extname(path)) &&
      !SKIPPED_PATHS.some((pattern) => pattern.test(path))
  )

const changed: string[] = []
for (const path of paths) {
  const file = resolve(root, path)
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null || !text.includes(OLD)) continue
  const next = rebrand(text, extname(path))
  if (next === text) continue
  changed.push(path)
  if (!check) await writeFile(file, next)
}

for (const path of changed) console.log(path)
if (check && changed.length > 0) {
  console.error(`${changed.length} files still name ${OLD}; run bun desktop/pena/rebrand.ts`)
  process.exit(1)
}
console.error(`${check ? 'Checked' : 'Rebranded'} ${changed.length} files.`)
