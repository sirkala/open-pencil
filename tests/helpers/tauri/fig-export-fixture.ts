import { mockIPC } from '@tauri-apps/api/mocks'
import * as v from 'valibot'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { installNativeFigArchives } from '@/app/document/io/native-fig'

import { installTauriMockWindow } from './mocks'

installTauriMockWindow()

const manifestSchema = v.object({
  metaJson: v.string(),
  board: v.boolean(),
  schemaDeflated: v.number(),
  kiwiData: v.number(),
  thumbnailPng: v.number(),
  images: v.array(v.object({ name: v.string(), size: v.number() }))
})

mockIPC((cmd, args) => {
  if (cmd !== 'build_fig_file') throw new Error(`Unexpected command: ${cmd}`)
  // The parts travel as one binary body, which Tauri hands to Rust untouched.
  if (!(args instanceof Uint8Array)) throw new Error('the request is not a binary body')
  const length = new DataView(args.buffer, args.byteOffset).getUint32(0, true)
  const parsed = v.safeParse(
    v.pipe(v.string(), v.parseJson(), manifestSchema),
    new TextDecoder().decode(args.subarray(4, 4 + length))
  )
  if (!parsed.success) throw new Error('the manifest does not parse')
  const manifest = parsed.output
  if (manifest.board) throw new Error('a new design is no board')
  if (manifest.schemaDeflated === 0) throw new Error('schemaDeflated is empty')
  if (manifest.kiwiData === 0) throw new Error('kiwiData is empty')
  if (manifest.thumbnailPng === 0) throw new Error('thumbnailPng is empty')
  if (manifest.images.length !== 0) throw new Error('images should be empty')
  const parts = manifest.schemaDeflated + manifest.kiwiData + manifest.thumbnailPng
  if (args.length !== 4 + length + parts) throw new Error('the parts do not fill the body')
  JSON.parse(manifest.metaJson)
  return new Uint8Array([7, 8, 9]).buffer
})

installNativeFigArchives()
const bytes = await exportFigFile(new SceneGraph())
if (bytes.length !== 3 || bytes[0] !== 7 || bytes[1] !== 8 || bytes[2] !== 9) {
  throw new Error(`Unexpected export bytes: ${Array.from(bytes).join(',')}`)
}
