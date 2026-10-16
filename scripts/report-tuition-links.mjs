// Tuitions on Google — sitemap audit and internal-link coverage (owner, 16 Oct
// 2026). READ-ONLY live crawl.
//
//   node scripts/report-tuition-links.mjs [base] [extra tuition URL …]
//
// 1. Every URL in every child sitemap: status (no redirect following), robots
//    noindex, canonical (self or not), and for a tuition whether it carries
//    JobPosting and whether it shows the paused banner. Counts per sitemap.
// 2. Internal links: which tuition pages are linked from at least one indexable
//    hub (every non-tuition URL in the sitemaps) or the homepage, and which
//    tuitions from the tuition sitemap are linked from nowhere.
// 3. Any extra URL given is inspected and printed in full (status, robots,
//    canonical, JSON-LD types, banner).
//
// Uses the crawler token the search log ignores (lib/searchCountCore).

const args = process.argv.slice(2)
const BASE = (args[0] && args[0].startsWith('http') && !args[0].includes('/tuitions/') ? args.shift() : 'https://www.tutormint.org').replace(/\/$/, '')
const EXTRA = args
const UA = 'Mozilla/5.0 (Linux; Android 13) TutorMint-link-check'

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } })
      const text = res.status === 200 ? await res.text() : ''
      return { status: res.status, location: res.headers.get('location'), text, xrobots: res.headers.get('x-robots-tag') }
    } catch {
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  return { status: 0, location: null, text: '', xrobots: null }
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))

function inspect(html) {
  const robots = (html.match(/<meta[^>]+name="robots"[^>]*>/i) || [''])[0]
  const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [, ''])[1]
  const types = []
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1])
      for (const n of Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j]) types.push(n['@type'])
    } catch {
      types.push('INVALID_JSON')
    }
  }
  return {
    noindex: /noindex/i.test(robots),
    robots,
    canonical,
    types,
    pausedBanner: /no longer accepting applications|is paused — it is not accepting/i.test(html),
    newestBlock: /Newest tuitions/.test(html),
  }
}

const isTuition = (u) => /^\/tuitions\/[^/]+\/[^/]+-[0-9a-f]{4,}$/.test(new URL(u).pathname)

function tuitionLinks(html) {
  const out = new Set()
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/gi)) {
    const raw = m[1].replace(/&amp;/g, '&').trim()
    let u
    try {
      u = new URL(raw, BASE)
    } catch {
      continue
    }
    if (u.origin !== BASE) continue
    if (isTuition(u.toString())) out.add(u.pathname)
  }
  return out
}

async function pool(items, n, fn) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

async function main() {
  const root = await get(`${BASE}/sitemap.xml`)
  const children = /<sitemapindex/.test(root.text) ? locs(root.text) : []
  const files = {}
  for (const c of children) files[new URL(c).pathname] = locs((await get(BASE + new URL(c).pathname)).text).map((u) => BASE + new URL(u).pathname)

  const perFile = {}
  const problems = []
  const tuitionState = new Map()
  const linkedTuitions = new Set()
  for (const [file, urls] of Object.entries(files)) {
    const c = { listed: urls.length, ok: 0, non200: 0, noindex: 0, nonCanonical: 0, tuitionNoJobPosting: 0, paused: 0 }
    perFile[file] = c
    await pool(urls, 8, async (url) => {
      const r = await get(url)
      if (r.status !== 200) {
        c.non200++
        problems.push({ file, url, problem: `status ${r.status}${r.location ? ` -> ${r.location}` : ''}` })
        return
      }
      const i = inspect(r.text)
      const self = new URL(url).pathname
      const canon = i.canonical ? new URL(i.canonical, BASE).pathname : ''
      let bad = false
      if (i.noindex || /noindex/i.test(r.xrobots ?? '')) {
        c.noindex++
        bad = true
        problems.push({ file, url, problem: 'noindex' })
      }
      if (canon !== self) {
        c.nonCanonical++
        bad = true
        problems.push({ file, url, problem: `canonical ${i.canonical || 'missing'}` })
      }
      if (isTuition(url)) {
        tuitionState.set(self, i)
        if (i.pausedBanner) c.paused++
        else if (!i.types.includes('JobPosting')) {
          c.tuitionNoJobPosting++
          problems.push({ file, url, problem: 'open tuition without JobPosting' })
        }
      } else {
        // An indexable hub (or the homepage): count the tuitions it links.
        if (!bad) for (const t of tuitionLinks(r.text)) linkedTuitions.add(t)
      }
      if (!bad) c.ok++
    })
  }

  const tuitionPaths = [...tuitionState.keys()]
  const live = tuitionPaths.filter((p) => !tuitionState.get(p).pausedBanner)
  const unlinkedLive = live.filter((p) => !linkedTuitions.has(p))

  const extra = []
  for (const u of EXTRA) {
    const r = await get(u)
    extra.push({ url: u, status: r.status, location: r.location, ...(r.status === 200 ? inspect(r.text) : {}) })
  }

  console.log(
    JSON.stringify(
      {
        base: BASE,
        perFile,
        problems: problems.slice(0, 80),
        problemCount: problems.length,
        liveTuitionsInSitemap: live.length,
        liveTuitionsLinkedFromAHubOrHome: live.length - unlinkedLive.length,
        liveTuitionsLinkedFromNowhere: unlinkedLive.length,
        unlinkedSample: unlinkedLive.slice(0, 15),
        extra,
      },
      null,
      1,
    ),
  )
}

main()
