// Read-only SEO audit of the live site (owner, 12 Oct 2026).
//
//   node scripts/audit-seo-live.mjs [base] > out.json
//
// Fetches the sitemap (an index or a flat file), then every listed URL without
// following redirects, and reports per page type: status, noindex, and which
// JSON-LD types the page carries. Writes nothing anywhere.

const BASE = process.argv[2] || 'https://www.tutormint.org'
const UA = 'Mozilla/5.0 (Linux; Android 13) TutorMint-SEO-audit'

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } })
      const text = res.status === 200 ? await res.text() : ''
      return { status: res.status, location: res.headers.get('location'), text }
    } catch {
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  return { status: 0, location: null, text: '' }
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))

export function typeOf(u) {
  const p = new URL(u).pathname
  if (p === '/' || p === '') return 'home'
  if (/^\/tutor\/[^/]+$/.test(p)) return 'tutor profile'
  if (/^\/tuition-jobs\/school\//.test(p)) return 'school hub'
  if (/^\/tuition-jobs\/[^/]+\/[^/]+$/.test(p)) return 'city variant / area hub'
  if (/^\/tuition-jobs\/[^/]+$/.test(p)) return 'city hub'
  if (/^\/tutors\/[^/]+\/[^/]+$/.test(p)) return 'tutor landing'
  if (/^\/tuitions\/[^/]+\/[^/]+$/.test(p)) return /-[0-9a-f]{4,}$/.test(p) ? 'tuition detail' : 'tuition landing'
  if (/^\/blog\/[^/]+$/.test(p)) return 'blog post'
  return 'static'
}

function inspect(html) {
  const robots = (html.match(/<meta[^>]+name="robots"[^>]*>/i) || [''])[0]
  const noindex = /noindex/i.test(robots)
  const types = []
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1])
      const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j]
      for (const n of nodes) types.push(n['@type'])
    } catch {
      types.push('INVALID_JSON')
    }
  }
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1]
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]
  const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [, ''])[1]
  return { noindex, types, title, desc, canonical }
}

async function main() {
  const root = await get(`${BASE}/sitemap.xml`)
  let urls = []
  const children = {}
  if (/<sitemapindex/.test(root.text)) {
    for (const child of locs(root.text)) {
      const c = await get(child)
      children[child] = { status: c.status, count: locs(c.text).length }
      urls.push(...locs(c.text))
    }
  } else urls = locs(root.text)

  const rows = []
  let i = 0
  async function worker() {
    while (i < urls.length) {
      const u = urls[i++]
      const r = await get(u)
      rows.push({ url: u, type: typeOf(u), status: r.status, location: r.location, ...(r.status === 200 ? inspect(r.text) : {}) })
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  const byType = {}
  for (const r of rows) {
    const t = (byType[r.type] ??= { total: 0, ok: 0, noindex: 0, redirect: 0, notFound: 0, other: 0, breadcrumb: 0, jobPosting: 0, queryString: 0 })
    t.total++
    if (r.status === 200) t.ok++
    else if (r.status >= 300 && r.status < 400) t.redirect++
    else if (r.status === 404) t.notFound++
    else t.other++
    if (r.noindex) t.noindex++
    if (r.types?.includes('BreadcrumbList')) t.breadcrumb++
    if (r.types?.includes('JobPosting')) t.jobPosting++
    if (r.url.includes('?')) t.queryString++
  }
  const bad = rows.filter((r) => r.status !== 200 || r.noindex || r.url.includes('?'))
  const over = rows.filter((r) => r.status === 200 && ((r.title || '').length > 60 || (r.desc || '').length > 155)).length
  console.log(JSON.stringify({ base: BASE, sitemapStatus: root.status, isIndex: /<sitemapindex/.test(root.text), children, total: urls.length, byType, bad, titleOrDescOver: over, rows }, null, 1))
}

if (process.argv[1] && process.argv[1].endsWith('audit-seo-live.mjs')) main()
