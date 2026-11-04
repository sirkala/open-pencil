import { strict as assert } from 'node:assert'

import { invokeNativeWithBody } from '#tests/helpers/tauri/invoke'

// A .fig file is a zip archive.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/** The body `src/app/document/io/native-fig.ts` sends: manifest length, manifest, then parts. */
function figRequest(parts: Uint8Array[], manifest: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const head = new Uint8Array(4)
  new DataView(head.buffer).setUint32(0, json.length, true)
  return new Uint8Array([...head, ...json, ...parts.flatMap((part) => [...part])])
}

describe('native .fig export', () => {
  it('packs an archive from a binary request body', async () => {
    const [schema, kiwi, thumbnail, image] = [[1, 2], [3, 4, 5], [6], [7, 8]].map(
      (bytes) => new Uint8Array(bytes)
    )
    const archive = await invokeNativeWithBody(
      'build_fig_file',
      figRequest([schema, kiwi, thumbnail, image], {
        metaJson: JSON.stringify({ file_name: 'Café' }),
        board: false,
        schemaDeflated: schema.length,
        kiwiData: kiwi.length,
        thumbnailPng: thumbnail.length,
        images: [{ name: 'images/a', size: image.length }]
      })
    )
    assert.deepEqual(archive.slice(0, 4), ZIP_SIGNATURE)
    // Stored entries keep their names readable in the archive.
    const text = new TextDecoder().decode(new Uint8Array(archive))
    for (const name of ['canvas.fig', 'thumbnail.png', 'meta.json', 'images/a', 'Café']) {
      assert.ok(text.includes(name), `${name} is missing from the archive`)
    }
  })
})
