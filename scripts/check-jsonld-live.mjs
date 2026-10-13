// scripts/check-jsonld-live.mjs — `npm run check:jsonld` (read-only, live).
//
// Fetches one page of each public type and checks what Google would read
// (owner, 13 Oct 2026): <title>, meta description, canonical, robots, H1 and
// every JSON-LD block. Fails (exit 1) when a block is not valid JSON, when
// Organization or WebSite is missing or appears twice, when a rating or review
// appears anywhere, or when a tutor's Person carries a phone, email, address
// or fee.
//
// It only GETs pages, with the fixed user-agent the search logs skip
// (lib/searchCountCore OWN_CRAWLER_TOKENS), and never runs a page's script — so
// it adds no search row and changes nothing.
//
//   node scripts/check-jsonld-live.mjs            → the table
//   node scripts/check-jsonld-live.mjs --json     → the same, as JSON

const BASE = (process.env.SITE_URL || 'https://www.tutormint.org').replace(/\/+$/, '')
const UA = 'TutorMint-SEO-audit'
const asJson = process.argv.includes('--json')

const get = async (path) => {
  const res = await fetch(BASE + path, { headers: { 'user-agent': UA }, redirect: 'manual' })
  return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() }
}
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(BASE, ''))
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const plain = (s) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

// --- pick one live page of each type from the sitemaps ----------------------
const index = await get('/sitemap.xml')
const counts = {}
const all = {}
for (const child of locs(index.text)) {
  const name = child.replace(/^\/sitemap-|\.xml$/g, '')
  all[name] = locs((await get(child)).text)
  counts[name] = all[name].length
}
const pages = all.pages ?? []
const first = (list, re) => (list ?? []).find((u) => re.test(u)) ?? null
const targets = {
  homepage: '/',
  about: '/about',
  'browse tutors': '/browse/tutors',
  'tutor profile': first(all.tutors, /^\/tutor\//),
  tuition: first(all.tuitions, /^\/tuitions\//),
  'city hub': first(pages, /^\/tuition-jobs\/(?!school\/)[^/]+$/),
  'city × subject (tutors)': first(pages, /^\/tutors\/[^/]+\/[^/]+$/),
  'city × subject (tuitions)': first(pages, /^\/tuitions\/[^/]+\/[^/]+$/),
  'school hub': first(pages, /^\/tuition-jobs\/school\//),
  'area hub': first(pages, /^\/tuition-jobs\/(?!school\/)[^/]+\/(?!female$|online$)[^/]+$/),
  'blog post': first(all.blog, /^\/blog\//),
  'membership plans': '/membership-plans',
  faq: '/faq',
  'how it works': '/how-it-works',
  'llms.txt': '/llms.txt',
}

const problems = []
const rows = []

function nodesOf(block) {
  return Array.isArray(block['@graph']) ? block['@graph'] : [block]
}
function walk(v, fn) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn))
  else if (v && typeof v === 'object') {
    fn(v)
    Object.values(v).forEach((x) => walk(x, fn))
  }
}

for (const [name, path] of Object.entries(targets)) {
  if (!path) {
    rows.push({ page: name, url: null, status: 'no such page in the sitemap' })
    continue
  }
  const res = await get(path)
  const row = { page: name, url: path, status: res.status }
  if (res.status !== 200 || !/html/.test(res.type)) {
    if (res.status === 200) row.note = res.type.split(';')[0]
    rows.push(row)
    continue
  }
  const html = res.text
  const one = (re) => {
    const m = html.match(re)
    return m ? decode(m[1]) : null
  }
  row.title = one(/<title>([^<]*)<\/title>/)
  row.description = one(/<meta name="description" content="([^"]*)"/)
  row.canonical = one(/<link rel="canonical" href="([^"]*)"/)
  row.robots = one(/<meta name="robots" content="([^"]*)"/)
  row.h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => plain(m[1]))
  row.jsonld = []
  const types = []
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let block
    try {
      block = JSON.parse(m[1])
    } catch {
      problems.push(`${path}: a JSON-LD block is not valid JSON`)
      continue
    }
    for (const node of nodesOf(block)) {
      const t = String(node['@type'])
      types.push(t)
      let note = ''
      if (t === 'ItemList') note = ` (${node.itemListElement?.length ?? 0} items)`
      if (t === 'FAQPage') note = ` (${node.mainEntity?.length ?? 0} questions)`
      if (t === 'JobPosting') note = ` (hiringOrganization: ${node.hiringOrganization?.name}; directApply: ${node.directApply})`
      if (t === 'Person') note = ` (jobTitle: ${node.jobTitle}; image: ${node.image ? 'yes' : 'no'})`
      if (t === 'Organization') note = ` (${node.name}; sameAs: ${node.sameAs?.length ?? 0})`
      if (t === 'Article' || t === 'BlogPosting') note = ` (publisher: ${node.publisher?.name})`
      row.jsonld.push(t + note)
      if (t === 'Person') {
        for (const banned of ['telephone', 'email', 'address', 'worksFor', 'affiliation', 'offers']) {
          if (node[banned] !== undefined) problems.push(`${path}: Person carries ${banned}`)
        }
      }
    }
    walk(block, (o) => {
      if (['AggregateRating', 'Review', 'Rating'].includes(o['@type']) || o.aggregateRating !== undefined || o.review !== undefined) {
        problems.push(`${path}: a rating or review is in the structured data`)
      }
    })
  }
  for (const t of ['Organization', 'WebSite']) {
    const n = types.filter((x) => x === t).length
    if (n !== 1) problems.push(`${path}: ${t} appears ${n} times (expected once)`)
  }
  if (!row.title) problems.push(`${path}: no <title>`)
  if (!row.description) problems.push(`${path}: no meta description`)
  if (row.h1.length !== 1) problems.push(`${path}: ${row.h1.length} <h1> elements`)
  rows.push(row)
}

if (asJson) {
  console.log(JSON.stringify({ base: BASE, sitemaps: counts, rows, problems }, null, 1))
} else {
  console.log(`Sitemaps: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  for (const r of rows) {
    console.log(`\n${r.page} — ${r.url ?? ''} — ${r.status}${r.note ? ' ' + r.note : ''}`)
    if (!r.title) continue
    console.log(`  title:       ${r.title}`)
    console.log(`  description: ${r.description}`)
    console.log(`  canonical:   ${r.canonical}   robots: ${r.robots ?? 'none'}`)
    console.log(`  h1:          ${r.h1.join(' | ')}`)
    console.log(`  JSON-LD:     ${r.jsonld.join(', ')}`)
  }
  console.log(problems.length ? `\nProblems:\n- ${problems.join('\n- ')}` : '\nNo problems.')
}
process.exit(problems.length ? 1 : 0)
