import { describe, expect, test } from 'bun:test'

import { zipSync } from 'fflate'
import { toUint8Array } from 'js-base64'

import { IORegistry, penFormat } from '@open-pencil/core/io'

// A 2 × 1 PNG.
const PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP8zwACAAYIAQFazwZIAAAAAElFTkSuQmCC'
)

const io = new IORegistry([penFormat])

function penJSON(name: string, url: string) {
  return new TextEncoder().encode(
    JSON.stringify({
      version: '2.22',
      children: [
        {
          id: 'photo',
          type: 'rectangle',
          name,
          width: 20,
          height: 10,
          fill: { type: 'image', url }
        }
      ]
    })
  )
}

describe('penFormat.readDocument — archives', () => {
  test('opens a snapshot archive with the images it holds', async () => {
    const asked: string[] = []
    const { graph } = await io.readDocument({
      name: 'landing.pen',
      data: zipSync({
        'landing.pen': penJSON('Landing', 'images/my%20photo.png'),
        'images/my photo.png': PNG,
        '__MACOSX/._landing.pen': new Uint8Array([0])
      }),
      readAsset: async (path) => {
        asked.push(path)
        return null
      }
    })
    expect(graph.getNode('photo')?.name).toBe('Landing')
    expect(graph.getNode('photo')?.fills[0]?.type).toBe('IMAGE')
    expect(asked).toEqual([])
  })

  test('reads the document a renamed snapshot is named after', async () => {
    for (const name of ['landing-snapshot.zip.pen', 'landing-snapshot.pen', 'landing.pen']) {
      const { graph } = await io.readDocument({
        name,
        data: zipSync({
          'other.pen': penJSON('Other', './a.png'),
          'landing.pen': penJSON('Landing', './a.png'),
          'a.png': PNG
        })
      })
      expect(graph.getNode('photo')?.name).toBe('Landing')
    }
  })

  test('reads a document over the libraries beside it', async () => {
    const { graph } = await io.readDocument({
      name: 'renamed.pen',
      data: zipSync({
        'shadcn.lib.pen': penJSON('Library', './a.png'),
        'landing.pen': penJSON('Landing', './a.png'),
        'a.png': PNG
      })
    })
    expect(graph.getNode('photo')?.name).toBe('Landing')
  })

  test('falls back to the host for images the archive lacks', async () => {
    const { graph } = await io.readDocument({
      name: 'landing.pen',
      data: zipSync({ 'landing.pen': penJSON('Landing', './beside.png') }),
      readAsset: async (path) => (path === './beside.png' ? PNG : null)
    })
    expect(graph.getNode('photo')?.fills[0]?.type).toBe('IMAGE')
  })

  test('rejects an archive without a .pen document', async () => {
    const read = io.readDocument({
      name: 'empty.pen',
      data: zipSync({ 'readme.txt': new TextEncoder().encode('hi') })
    })
    await expect(read).rejects.toThrow('Not a .pen document: the archive holds no .pen file')
  })
})
