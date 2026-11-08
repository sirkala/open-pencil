// Assembles the files of a Pena release: the signed updater archive under its release name, its
// signature, and the latest.json the installed apps read from the newest GitHub release. The
// archive must be signed by the key in desktop/pena/tauri.conf.json for this version, or the
// apps would refuse the update, so this checks the signature before writing anything.
// Usage: bun desktop/pena/updater.ts <target triple> <bundle dir> <version> <output dir>
// PENA_RELEASE_NOTES names a Markdown file with the notes; without it, the version's
// CHANGELOG.md section is used.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parseChangelog } from 'changelog-parser'
import { decode, isValid, toUint8Array } from 'js-base64'
import * as v from 'valibot'

const ROOT = resolve(import.meta.dir, '../..')
const CONFIG = join(import.meta.dir, 'tauri.conf.json')

/** Tauri's updater platform key and the architecture in the asset name, per target triple. */
const TARGETS: Record<string, { platform: string; arch: string }> = {
  'aarch64-apple-darwin': { platform: 'darwin-aarch64', arch: 'aarch64' },
  'x86_64-apple-darwin': { platform: 'darwin-x86_64', arch: 'x64' }
}

const ENDPOINT =
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/latest\/download\/latest\.json$/

const configSchema = v.object({
  plugins: v.object({
    updater: v.object({
      pubkey: v.string(),
      endpoints: v.tuple([v.pipe(v.string(), v.regex(ENDPOINT))])
    })
  })
})

// The DER header of an Ed25519 public key, which the raw 32 key bytes follow.
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
])
const TRUSTED_COMMENT = 'trusted comment: '

const [triple, bundle, version, output] = process.argv.slice(2)
const target = triple ? TARGETS[triple] : undefined
if (!target || !bundle || !version || !output) {
  throw new Error(
    'Usage: bun desktop/pena/updater.ts <target triple> <bundle dir> <version> <output dir>'
  )
}

const parsed = v.safeParse(
  v.pipe(v.string(), v.parseJson(), configSchema),
  await readFile(CONFIG, 'utf8')
)
if (!parsed.success)
  throw new Error(`${CONFIG} has no single GitHub updater endpoint and public key`)
const { pubkey, endpoints } = parsed.output.plugins.updater
const repository = ENDPOINT.exec(endpoints[0])?.[1]
if (!repository) throw new Error('Unreachable: the endpoint matched the pattern')

/** The base64 line of a minisign key or signature file, which Tauri wraps in base64 again. */
function minisignLines(wrapped: string, what: string): string[] {
  if (!isValid(wrapped)) throw new Error(`${what} is not base64`)
  return decode(wrapped).split(/\r?\n/)
}

function payload(line: string | undefined, length: number, what: string): Uint8Array {
  if (!line || !isValid(line)) throw new Error(`${what} is malformed`)
  const bytes = toUint8Array(line)
  if (bytes.length !== length) throw new Error(`${what} is malformed`)
  return bytes
}

function sameKeyId(a: Uint8Array, b: Uint8Array): boolean {
  return a.subarray(2, 10).every((byte, index) => byte === b[index + 2])
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** Checks a minisign signature as the Tauri updater does, and returns the version it records. */
function verifiedVersion(archive: Uint8Array, signature: string): string {
  const keyLines = minisignLines(pubkey, 'The configured public key')
  const key = payload(keyLines[1], 42, 'The configured public key')
  const lines = minisignLines(signature, 'The signature')
  const signed = payload(lines[1], 74, 'The signature')
  const comment = lines[2]?.startsWith(TRUSTED_COMMENT)
    ? lines[2].slice(TRUSTED_COMMENT.length)
    : null
  const global = payload(lines[3], 64, 'The signature’s trusted comment signature')
  if (comment === null) throw new Error('The signature has no trusted comment')

  if (!sameKeyId(key, signed)) {
    throw new Error(
      'The archive is signed by another key than the one in desktop/pena/tauri.conf.json'
    )
  }
  const algorithm = String.fromCharCode(signed[0] ?? 0, signed[1] ?? 0)
  if (algorithm !== 'ED' && algorithm !== 'Ed')
    throw new Error(`Unknown signature algorithm ${algorithm}`)

  const publicKey = createPublicKey({
    key: Buffer.from(concat(ED25519_SPKI_PREFIX, key.subarray(10))),
    format: 'der',
    type: 'spki'
  })
  // `ED` signs the BLAKE2b-512 digest of the file, `Ed` the file itself.
  const message = algorithm === 'ED' ? createHash('blake2b512').update(archive).digest() : archive
  const signatureBytes = signed.subarray(10)
  if (!verify(null, message, publicKey, signatureBytes))
    throw new Error('The archive signature is invalid')
  const commented = concat(signatureBytes, new TextEncoder().encode(comment))
  if (!verify(null, commented, publicKey, global))
    throw new Error('The trusted comment signature is invalid')

  const field = comment.split('\t').find((entry) => entry.startsWith('version:'))
  if (!field) throw new Error('The signature does not record a version')
  return field.slice('version:'.length)
}

async function releaseNotes(): Promise<string> {
  const file = process.env.PENA_RELEASE_NOTES
  if (file) return `${(await readFile(file, 'utf8')).trim()}\n`
  const changelog = await parseChangelog({
    filePath: join(ROOT, 'CHANGELOG.md'),
    removeMarkdown: false
  })
  const notes = changelog.versions.find((entry) => entry.version === version)?.body.trim()
  if (!notes) throw new Error(`CHANGELOG.md has no notes for ${version}; set PENA_RELEASE_NOTES`)
  return `${notes}\n`
}

const source = join(bundle, 'macos', 'Pena.app.tar.gz')
const archive = new Uint8Array(await readFile(source))
const signature = (await readFile(`${source}.sig`, 'utf8')).trim()
const signedVersion = verifiedVersion(archive, signature)
if (signedVersion !== version) {
  throw new Error(
    `The archive is signed for ${signedVersion}, not ${version}; match the versions in desktop/`
  )
}

const asset = `Pena_${version}_${target.arch}.app.tar.gz`
const notes = await releaseNotes()
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await copyFile(source, join(output, asset))
await writeFile(join(output, `${asset}.sig`), `${signature}\n`)
await writeFile(join(output, 'notes.md'), notes)
await writeFile(
  join(output, 'latest.json'),
  `${JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        [target.platform]: {
          signature,
          url: `https://github.com/${repository}/releases/download/v${version}/${asset}`
        }
      }
    },
    null,
    2
  )}\n`
)
console.log(`Pena ${version} release files for ${repository} are in ${output}`)
