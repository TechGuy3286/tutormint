// scripts/screenshots/oct28.mjs — bundles oct28-entry.tsx for the browser and
// writes one HTML page per screenshot, styled by the built site CSS.
//   node scripts/screenshots/oct28.mjs <out-folder>
// Then capture each page with headless Chrome. Invented data only.
import { build } from 'esbuild'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? '.')
mkdirSync(out, { recursive: true })
await build({
  entryPoints: ['scripts/screenshots/oct28-entry.tsx'],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: join(out, 'bundle.js'),
  alias: { '@': resolve('.'), 'server-only': resolve('scripts/screenshots/stubs/empty.js') },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  logLevel: 'error',
})
const cssDir = '.next/static/chunks'
const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
for (const shot of ['apps', 'locations', 'share']) {
  writeFileSync(
    join(out, `${shot}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div id="root" style="max-width:1000px;margin:0 auto"></div><script>window.__SHOT='${shot}'</script><script src="bundle.js"></script></body></html>`,
  )
}
console.log('written to', out)
