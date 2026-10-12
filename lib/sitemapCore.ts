// lib/sitemapCore.ts
//
// What may be listed in a sitemap, and the XML it is written as (owner, 12 Oct
// 2026). PURE — the routes, the loaders and the tests share it.
//
// /sitemap.xml is an INDEX of four files:
//   /sitemap-tuitions.xml  open tuitions only
//   /sitemap-tutors.xml    indexable tutor profiles only (fee paid + CNIC,
//                          photo and selfie approved)
//   /sitemap-pages.xml     the static pages and the hubs that clear their rule
//   /sitemap-blog.xml      published posts
//
// THE RULE: a URL is listed only if its own page would be indexable. Every
// candidate passes through the SAME predicate its page uses for its robots tag
// (lib/seo/indexable, the hub thresholds), so the two cannot drift; and a URL
// with a query string, on another host, or listed twice is dropped whatever it
// claims. scripts/test-seo-search-console.ts feeds noindex candidates through
// these functions and fails if one comes out the other side.

import { tuitionIndexable, tutorProfileIndexable, type TutorIndexFacts } from '@/lib/seo/indexable'

export const SITEMAP_FILES = ['tuitions', 'tutors', 'pages', 'blog'] as const
export type SitemapFile = (typeof SITEMAP_FILES)[number]

export function sitemapFilePath(file: SitemapFile): string {
  return `/sitemap-${file}.xml`
}

export type SitemapEntry = {
  url: string
  lastmod?: string | Date | null
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  priority?: number
}

/** Drop anything that must never be listed: query strings, fragments, another
 *  host, a relative address, a duplicate. */
export function cleanEntries(entries: SitemapEntry[], base: string): SitemapEntry[] {
  const seen = new Set<string>()
  const out: SitemapEntry[] = []
  for (const e of entries) {
    const url = (e.url ?? '').trim()
    if (!url.startsWith(base)) continue
    if (url.includes('?') || url.includes('#')) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ ...e, url })
  }
  return out
}

export type TuitionCandidate = {
  path: string
  status: string | null
  isFixture: boolean
  descriptionLength: number
  /** Merged into another tuition: its address redirects. */
  merged?: boolean
  lastmod?: string | null
}

/** Open, not a fixture, not a thin one-liner, not a redirect. */
export function tuitionSitemapEntries(base: string, cands: TuitionCandidate[]): SitemapEntry[] {
  return cleanEntries(
    cands
      .filter((c) => !c.merged && tuitionIndexable({ status: c.status, isFixture: c.isFixture, descriptionLength: c.descriptionLength }))
      .map((c) => ({ url: base + c.path, lastmod: c.lastmod ?? null, changefreq: 'daily' as const, priority: 0.6 })),
    base,
  )
}

export type TutorCandidate = TutorIndexFacts & { path: string; lastmod?: string | null }

/** Fee paid + CNIC, photo and selfie approved; never a seed or under-review profile. */
export function tutorSitemapEntries(base: string, cands: TutorCandidate[]): SitemapEntry[] {
  return cleanEntries(
    cands
      .filter((c) => tutorProfileIndexable(c))
      .map((c) => ({ url: base + c.path, lastmod: c.lastmod ?? null, changefreq: 'weekly' as const, priority: 0.8 })),
    base,
  )
}

export type HubCandidate = {
  path: string
  /** Live items the rule counts: open posts, or verified tutors for a tutor page. */
  count: number
  threshold: number
  /** An 80%+ overlap with a broader page in the same city (noindex). */
  overlap?: boolean
  lastmod?: string | Date | null
  priority?: number
}

/** A hub is listed only at or above its threshold, and never when it is a near-duplicate. */
export function hubIndexable(c: { count: number; threshold: number; overlap?: boolean }): boolean {
  return c.count >= c.threshold && !c.overlap
}

export function hubSitemapEntries(base: string, cands: HubCandidate[]): SitemapEntry[] {
  return cleanEntries(
    cands
      .filter(hubIndexable)
      .map((c) => ({ url: base + c.path, lastmod: c.lastmod ?? null, changefreq: 'daily' as const, priority: c.priority ?? 0.7 })),
    base,
  )
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function iso(d: string | Date | null | undefined): string | null {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const rows = entries.map((e) => {
    const lastmod = iso(e.lastmod)
    return (
      `<url><loc>${esc(e.url)}</loc>` +
      (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
      (e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : '') +
      (typeof e.priority === 'number' ? `<priority>${e.priority.toFixed(1)}</priority>` : '') +
      `</url>`
    )
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}

export function sitemapIndexXml(base: string, files: { file: SitemapFile; lastmod?: string | Date | null }[]): string {
  const rows = files.map((f) => {
    const lastmod = iso(f.lastmod)
    return `<sitemap><loc>${esc(base + sitemapFilePath(f.file))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</sitemapindex>\n`
}

/** The newest of a set of date-ish values, or null. */
export function newestOf(values: (string | Date | null | undefined)[]): Date | null {
  const times = values.map((v) => (v ? new Date(v).getTime() : NaN)).filter((t) => !Number.isNaN(t))
  return times.length ? new Date(Math.max(...times)) : null
}
