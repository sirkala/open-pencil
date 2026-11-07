import { unzipSync } from 'fflate'
import { filename } from 'pathe/utils'

import type { ReadDocumentInput } from '#core/io/types'

/** A ZIP archive's local file header signature, `PK\x03\x04`. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/** Folders archivers add beside the content, such as macOS Finder's resource forks. */
const IGNORED_FOLDERS = ['__MACOSX/']

/** Whether the bytes start a ZIP archive rather than a `.pen` document's JSON. */
export function isZipArchive(data: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => data[index] === byte)
}

/** An entry's or a document URL's path, as the archive spells it. */
function archivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '')
}

/** A URL path with its escapes decoded; as written when it holds a malformed escape. */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function isPenEntry(path: string): boolean {
  return path.toLowerCase().endsWith('.pen')
}

/**
 * The archive's document: the only `.pen` at its root, else the one named as the archive is, else
 * one that is not a library; deeper entries count only when the root holds none.
 */
function documentEntry(paths: readonly string[], archiveName: string | undefined): string | null {
  const pens = paths.filter(isPenEntry)
  if (pens.length === 0) return null
  const depth = (path: string) => path.split('/').length
  const shallowest = Math.min(...pens.map(depth))
  // Not empty: the shallowest depth is some entry's.
  const candidates = pens.filter((path) => depth(path) === shallowest)
  const stem = archiveName ? filename(archiveName)?.replace(/-snapshot$/, '') : undefined
  return (
    candidates.find((path) => filename(path) === stem) ??
    candidates.find((path) => !path.toLowerCase().endsWith('.lib.pen')) ??
    candidates[0]
  )
}

/** A `.pen` document's JSON and where the files it names are read from. */
export interface PenSource {
  json: Uint8Array
  input: ReadDocumentInput
}

/**
 * The document `input` holds: its bytes as they are, or, for an archive like pen.dev's snapshot
 * export, the `.pen` at its root with the images, fonts, and libraries packed beside it read from
 * the archive before the host. Throws for an archive that holds no `.pen` document.
 */
export function penSource(input: ReadDocumentInput): PenSource {
  if (!isZipArchive(input.data)) return { json: input.data, input }

  const entries = unzipSync(input.data, {
    filter: (entry) =>
      !entry.name.endsWith('/') && !IGNORED_FOLDERS.some((folder) => entry.name.startsWith(folder))
  })
  const files = new Map(Object.entries(entries).map(([path, bytes]) => [archivePath(path), bytes]))
  const entry = documentEntry([...files.keys()], input.name)
  const json = entry === null ? undefined : files.get(entry)
  if (!entry || !json) throw new Error('Not a .pen document: the archive holds no .pen file')
  const folder = entry.slice(0, entry.lastIndexOf('/') + 1)

  const packed = (path: string) => {
    const relative = archivePath(path)
    const decoded = decodedPath(relative)
    return (
      files.get(folder + relative) ??
      files.get(folder + decoded) ??
      files.get(relative) ??
      files.get(decoded) ??
      null
    )
  }
  return {
    json,
    input: {
      ...input,
      readAsset: async (path) => packed(path) ?? (await input.readAsset?.(path)) ?? null
    }
  }
}
