import { invoke } from '@tauri-apps/api/core'

import { setFigArchiveAssembler, type FigArchiveParts } from '@open-pencil/core/io/formats/fig'

/**
 * The archive's parts as one binary IPC body, which Tauri hands to Rust untouched: a little-endian
 * u32 manifest length, the manifest as UTF-8 JSON, then the schema, Kiwi data, thumbnail and each
 * image back to back. An object payload would go as JSON, one number per byte, which for a large
 * design kit is gigabytes and seconds on both sides (`desktop/src/files/fig.rs`).
 */
function encodeFigArchiveRequest(parts: FigArchiveParts): Uint8Array {
  const sections = [
    parts.schemaDeflated,
    parts.kiwiData,
    parts.thumbnailPNG,
    ...parts.images.map((image) => image.data)
  ]
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      metaJson: parts.metaJSON,
      figKiwiVersion: parts.figKiwiVersion,
      compressionLevel: parts.compressionLevel,
      board: parts.documentKind === 'board',
      schemaDeflated: parts.schemaDeflated.length,
      kiwiData: parts.kiwiData.length,
      thumbnailPng: parts.thumbnailPNG.length,
      images: parts.images.map((image) => ({ name: image.name, size: image.data.length }))
    })
  )
  let length = 4 + manifest.length
  for (const section of sections) length += section.length
  const body = new Uint8Array(length)
  new DataView(body.buffer).setUint32(0, manifest.length, true)
  body.set(manifest, 4)
  let offset = 4 + manifest.length
  for (const section of sections) {
    body.set(section, offset)
    offset += section.length
  }
  return body
}

/**
 * The desktop app packs every `.fig` it writes in Rust, on a blocking thread, since high
 * compression levels take seconds (`build_fig_file`, `desktop/AGENTS.md`).
 */
export function installNativeFigArchives(): void {
  setFigArchiveAssembler(
    async (parts) =>
      new Uint8Array(await invoke<ArrayBuffer>('build_fig_file', encodeFigArchiveRequest(parts)))
  )
}
