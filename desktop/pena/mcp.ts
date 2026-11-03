// Compiles this checkout's MCP server into one executable that Pena ships as a sidecar, so
// Pena starts a server at its own version beside OpenPencil's installed one.
// Usage: bun desktop/pena/mcp.ts <target triple> <output path>
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const BUN_TARGETS: Record<string, Bun.Build.CompileTarget> = {
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64'
}

const [triple, outfile] = process.argv.slice(2)
const target = triple ? BUN_TARGETS[triple] : undefined
if (!target || !outfile) throw new Error('Usage: bun desktop/pena/mcp.ts <target triple> <output>')

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, '../../packages/mcp/src/index.ts')],
  minify: true,
  compile: { target, outfile },
  plugins: [
    {
      name: 'pena-mcp',
      setup(build) {
        // Vite's `?raw` imports, which the workspace sources use for schemas.
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, '')),
          namespace: 'raw'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`,
          loader: 'js'
        }))
        // Packages such as css-tree read JSON through `createRequire` at run time, which a
        // compiled executable cannot; import the JSON statically instead.
        build.onLoad({ filter: /node_modules\/.*\.m?js$/ }, async (args) => {
          const text = await readFile(args.path, 'utf8')
          if (!text.includes('createRequire(import.meta.url)')) return undefined
          const imports: string[] = []
          const contents = text.replace(/require\((['"])([^'"]+\.json)\1\)/g, (_, _quote, spec) => {
            const name = `__json${imports.length}`
            imports.push(`import ${name} from ${JSON.stringify(spec)} with { type: 'json' }`)
            return name
          })
          return { contents: `${imports.join('\n')}\n${contents}`, loader: 'js' }
        })
      }
    }
  ]
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
