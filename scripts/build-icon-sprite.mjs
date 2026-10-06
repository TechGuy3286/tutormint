// scripts/build-icon-sprite.mjs — writes public/icons.svg, the SVG sprite the
// cards use instead of inline lucide SVGs (owner, 6 Oct 2026, item 14).
//
// WHY. Every tuition/tutor card inlined ~10 lucide icons (~0.5 KB each); twelve
// cards on Browse put ~60–80 KB of repeated path data in the HTML, which is what
// the first paint waited on over mobile bandwidth. A sprite ships each icon's
// paths ONCE in a cacheable file; a card references them with <use>.
//
// Source of truth is lucide-react's own icon data (`__iconNode` in
// node_modules/lucide-react/dist/esm/icons/<name>.mjs), so the drawings are
// identical to the components they replace. Run after a lucide upgrade:
//   node scripts/build-icon-sprite.mjs
// and commit public/icons.svg with it. components/Icon.tsx renders <use>.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ICONS = [
  'map-pin', 'building-2', 'graduation-cap', 'wallet', 'clock', 'file-text', 'send', 'heart', 'shield-check',
  'user-round', 'book-open', 'briefcase', 'play', 'message-circle', 'star', 'eye', 'handshake', 'badge-check', 'x',
  'house', 'wifi', 'users', 'monitor-smartphone', 'refresh-cw', 'copy',
]

async function main() {
  const symbols = []
  for (const name of ICONS) {
    const url = pathToFileURL(new URL(`../node_modules/lucide-react/dist/esm/icons/${name}.mjs`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    const mod = await import(url.href)
    const node = mod.__iconNode
    if (!Array.isArray(node)) throw new Error(`no __iconNode for ${name}`)
    const inner = node
      .map(([tag, attrs]) => {
        const a = Object.entries(attrs)
          .filter(([k]) => k !== 'key')
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
          .join(' ')
        return `<${tag} ${a}/>`
      })
      .join('')
    symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>\n`
  writeFileSync(new URL('../public/icons.svg', import.meta.url), svg)
  const bytes = readFileSync(new URL('../public/icons.svg', import.meta.url)).length
  console.log(`public/icons.svg: ${symbols.length} symbols, ${bytes} bytes`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
