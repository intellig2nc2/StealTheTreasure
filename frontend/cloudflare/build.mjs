import { readFileSync, readdirSync } from 'node:fs'
import { extname } from 'node:path'
import { build } from 'esbuild'
import { build as buildFrontend } from 'vite'

process.env.VITE_SHARED_TRAINING = '1'
await buildFrontend({ mode: 'sites' })

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
}
const assets = Object.fromEntries(readdirSync('dist', { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => {
    const file = `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/')
    const type = mime[extname(entry.name)] ?? 'application/octet-stream'
    return [`/${file.slice(5)}`, [type, readFileSync(file, type.startsWith('font/') ? 'base64' : 'utf8')]]
  }))
await build({
  entryPoints: ['cloudflare/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  define: { assets: JSON.stringify(assets) },
  outfile: 'dist/server/index.js',
})
