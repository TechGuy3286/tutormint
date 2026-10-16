/**
 * scripts/report-sitemaps-googlebot.mjs — read-only (owner, 16 Oct 2026).
 *
 * Fetches /sitemap.xml and every child sitemap as Googlebot and reports, per
 * file: status, content type, URL count, size, whether the XML parses, any
 * lastmod later than now, and (tuitions) any /tuition-jobs/ address or any
 * address that redirects. With --check-redirects every tuition URL is fetched
 * once (HEAD, no redirect follow).
 *
 *   node scripts/report-sitemaps-googlebot.mjs [base] [--check-redirects]
 */
const args = process.argv.slice(2)
const base = (args.find((a) => a.startsWith('http')) ?? 'https://www.tutormint.org').replace(/\/$/, '')
const checkRedirects = args.includes('--check-redirects')
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

function wellFormed(xml) {
  // A small structural check: one root, every tag closed in order.
  const stack = []
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  let m
  let roots = 0
  while ((m = re.exec(body))) {
    const [, close, name, , self] = m
    if (self) {
      if (stack.length === 0) roots++
      continue
    }
    if (close) {
      if (stack.pop() !== name) return false
    } else {
      if (stack.length === 0) roots++
      stack.push(name)
    }
  }
  return stack.length === 0 && roots === 1 && !/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(body)
}

async function fetchFile(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual' })
  const text = await r.text()
  return { status: r.status, type: r.headers.get('content-type'), text, bytes: Buffer.byteLength(text) }
}

const now = Date.now()
const index = await fetchFile(`${base}/sitemap.xml`)
const children = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
console.log(`/sitemap.xml  status ${index.status}  ${index.type}  ${children.length} sitemaps  ${index.bytes} bytes  valid XML: ${wellFormed(index.text)}`)
let total = 0
for (const child of children) {
  const f = await fetchFile(child)
  const locs = [...f.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  const lastmods = [...f.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => Date.parse(m[1]))
  const future = lastmods.filter((t) => t > now + 60_000).length
  const hubs = locs.filter((u) => u.includes('/tuition-jobs/')).length
  const offHost = locs.filter((u) => (u !== base && !u.startsWith(`${base}/`)) || u.includes("?")).length
  total += locs.length
  console.log(
    `${child.replace(base, '')}  status ${f.status}  ${f.type}  ${locs.length} URLs  ${f.bytes} bytes  valid XML: ${wellFormed(f.text)}  lastmod later than now: ${future}  off-host/query: ${offHost}${child.includes('tuitions') ? `  /tuition-jobs/: ${hubs}` : ''}`,
  )
  if (checkRedirects && child.includes('tuitions')) {
    let redirects = 0
    let bad = 0
    const list = []
    for (let i = 0; i < locs.length; i += 10) {
      const res = await Promise.all(
        locs.slice(i, i + 10).map(async (u) => {
          try {
            const r = await fetch(u, { method: 'HEAD', headers: { 'user-agent': UA }, redirect: 'manual' })
            return { u, s: r.status }
          } catch {
            return { u, s: 0 }
          }
        }),
      )
      for (const x of res) {
        if (x.s >= 300 && x.s < 400) {
          redirects++
          list.push(`${x.s} ${x.u}`)
        } else if (x.s !== 200) {
          bad++
          list.push(`${x.s} ${x.u}`)
        }
      }
    }
    console.log(`   tuition URLs that redirect: ${redirects}; not 200: ${bad}`)
    for (const l of list.slice(0, 20)) console.log('   ', l)
  }
}
console.log(`total URLs across child sitemaps: ${total}`)
