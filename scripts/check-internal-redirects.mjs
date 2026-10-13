// Internal links that hit a redirect (owner, 13 Oct 2026). Read-only.
//
//   npm run check:links            # the live site
//   node scripts/check-internal-redirects.mjs http://localhost:3000
//
// Crawls every page in the sitemap (plus a few public pages that are not in it),
// collects every internal <a href> on them, requests each distinct target once
// WITHOUT following redirects, and lists the ones that answer 3xx — with the
// pages that link them. Exits 1 when any is found, so it can gate a release.
//
// It also re-checks what the sitemap promises: every listed URL is 200, not
// noindex, and every listed tuition has a self canonical and a JobPosting.
//
// NOT counted as a redirecting link:
//   - a sign-in gate (the target answers 3xx to /login… because the crawler is
//     signed out — "Post a tuition", a dashboard);
//   - /api/… (ad clicks and the like redirect by design);
//   - a path in ALLOW below (none today).

const BASE = (process.argv[2] || 'https://www.tutormint.org').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Linux; Android 13) TutorMint-link-check'
// Paths that may be linked although they redirect. Empty on purpose: /apply is
// a deliberate short link for posts OUTSIDE the site, and a link to it from a
// page of the site is still reported.
const ALLOW = new Set([])
const EXTRA_PAGES = ['/register', '/login', '/forgot-password']

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

/** Internal link targets on a page, as absolute URLs without the fragment. */
export function internalLinks(html, pageUrl, base = BASE) {
  const out = new Set()
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/gi)) {
    const raw = m[1].replace(/&amp;/g, '&').trim()
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|whatsapp|sms):/i.test(raw)) continue
    let u
    try {
      u = new URL(raw, pageUrl)
    } catch {
      continue
    }
    if (u.origin !== new URL(base).origin) continue
    u.hash = ''
    out.add(u.toString())
  }
  return [...out]
}

/** Is this 3xx a redirecting LINK (true) or something the check leaves alone? */
export function countsAsRedirect(target, location, base = BASE) {
  const path = new URL(target).pathname
  if (path.startsWith('/api/')) return false
  if (ALLOW.has(path)) return false
  if (!location) return true
  let to
  try {
    to = new URL(location, base)
  } catch {
    return true
  }
  // A sign-in gate: the page exists, the crawler is just signed out.
  if (to.pathname === '/login') return false
  return true
}

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
  return { noindex: /noindex/i.test(robots), canonical, types }
}

const isTuition = (u) => /^\/tuitions\/[^/]+\/[^/]+-[0-9a-f]{4,}$/.test(new URL(u).pathname)

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
  let listed = []
  if (/<sitemapindex/.test(root.text)) for (const child of locs(root.text)) listed.push(...locs((await get(child)).text))
  else listed = locs(root.text)
  // The sitemap names the production host; crawl the base that was asked for.
  const rebase = (u) => BASE + new URL(u).pathname + new URL(u).search
  listed = [...new Set(listed.map(rebase))]
  const pages = [...new Set([...listed, ...EXTRA_PAGES.map((p) => BASE + p)])]

  const linkedFrom = new Map()
  const sitemapProblems = []
  let tuitions = 0
  await pool(pages, 8, async (page) => {
    const r = await get(page)
    const inSitemap = listed.includes(page)
    if (inSitemap && r.status !== 200) sitemapProblems.push({ url: page, problem: `status ${r.status}${r.location ? ` -> ${r.location}` : ''}` })
    if (r.status !== 200) return
    if (inSitemap) {
      const i = inspect(r.text)
      if (i.noindex) sitemapProblems.push({ url: page, problem: 'noindex' })
      if (isTuition(page)) {
        tuitions++
        const self = new URL(page).pathname
        const canon = i.canonical ? new URL(i.canonical, BASE).pathname : ''
        if (canon !== self) sitemapProblems.push({ url: page, problem: `canonical is ${i.canonical || 'missing'}` })
        if (!i.types.includes('JobPosting')) sitemapProblems.push({ url: page, problem: 'no JobPosting' })
      }
    }
    for (const t of internalLinks(r.text, page)) (linkedFrom.get(t) ?? linkedFrom.set(t, []).get(t)).push(page)
  })

  const targets = [...linkedFrom.keys()]
  const redirects = []
  const broken = []
  await pool(targets, 8, async (t) => {
    // A listed page was already fetched above and is known to be 200.
    const r = pages.includes(t) ? null : await get(t)
    if (!r) return
    if (r.status >= 300 && r.status < 400) {
      if (countsAsRedirect(t, r.location)) redirects.push({ link: t, status: r.status, location: r.location, linkedFrom: linkedFrom.get(t).length, example: linkedFrom.get(t)[0] })
    } else if (r.status === 404 || r.status === 0 || r.status >= 500) {
      broken.push({ link: t, status: r.status, linkedFrom: linkedFrom.get(t).length, example: linkedFrom.get(t)[0] })
    }
  })

  redirects.sort((a, b) => b.linkedFrom - a.linkedFrom)
  console.log(
    JSON.stringify(
      { base: BASE, sitemapUrls: listed.length, pagesCrawled: pages.length, tuitionsChecked: tuitions, linkTargets: targets.length, sitemapProblems, redirectingLinks: redirects, brokenLinks: broken },
      null,
      1,
    ),
  )
  if (redirects.length > 0 || sitemapProblems.length > 0) process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('check-internal-redirects.mjs')) main()
