import type { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/public'
import { citySegment } from '@/lib/slugs'
import { SITE_URL } from '@/lib/siteUrl'
import { liveLandingPages } from '@/lib/landing'
import { publishedSlugs } from '@/lib/blogFeed'

// The sitemap: every listed tutor and every open tuition.
//
// The version this replaced listed five URLs, three of which were login pages
// -- pages we do not want indexed at all -- and no tutor or job. Those are the
// only pages with organic-search value on the whole site.
//
// Tutor slugs come from listed_tutor_slugs(), a SECURITY DEFINER function:
// tutor_profiles is owner-or-admin under RLS, so a plain select here would
// return nothing and the sitemap would silently ship empty.
//
// TUITIONS NOW HAVE THEIR OWN PAGES. Until migration 40 this file pointed
// every job at `/browse/tuitions?job=<id>` -- a query parameter that page does
// not read, so a crawler following it landed on the unfiltered board and found
// the same list at fifty different URLs. Every open tuition has a real address
// now, and jobs without one (none, after the backfill) are simply omitted
// rather than pointed at a URL that resolves to something else.
//
// THE HOST MUST MATCH THE CANONICAL. lib/siteUrl.ts resolves to www, and
// next.config.ts permanently redirects the apex to it -- a sitemap listing
// apex URLs would hand a crawler a list of redirects.
//
// COMPUTED ON EVERY REQUEST (PR37 §3). With only `revalidate` this file was
// prerendered at build and served stale — a newly published post was missing
// and every lastmod was frozen at the build time. force-dynamic reads the
// database on each fetch, so a newly published post, a newly qualifying tutor or
// a new open tuition appears (and one that stops qualifying drops out) with no
// redeploy, and every lastmod is the record's own updated time. A crawler fetches
// the sitemap rarely, so the few RPCs per fetch are cheap.

export const dynamic = 'force-dynamic'

const BASE = SITE_URL

// HONEST lastmod for the code-only static pages (PR38 §3). The homepage and the
// marketing/legal pages (about, faq, support, privacy, terms) change only when
// their code changes, so they carry a STORED date — not `now`, which the
// force-dynamic sitemap would otherwise stamp on every request, making a static
// page look edited on every crawl. Bump this the next time that content changes.
// Data-backed pages (blog index, the two browse pages, landing) get their lastmod
// from the newest relevant record instead.
const STATIC_LASTMOD = new Date('2026-09-19T00:00:00.000Z')

/** The newest of a set of date-ish values, or null when there are none. */
function newest(values: (string | null | undefined)[]): Date | null {
  const times = values.filter(Boolean).map((v) => new Date(v as string).getTime()).filter((t) => !Number.isNaN(t))
  return times.length ? new Date(Math.max(...times)) : null
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The database reads first (PR37: live, force-dynamic). A blip leaves the
  // arrays empty and the static pages still ship — never a 500 for a crawler.
  let tutors: { slug: string; updated_at: string }[] = []
  let jobs: { public_slug: string; city: string | null; created_at: string }[] = []
  let landing: { kind: string; citySlug: string; subjectSlug: string }[] = []
  let posts: { slug: string; updatedAt: string | null }[] = []
  try {
    const supabase = createPublicClient()
    // Both reads go through SECURITY DEFINER functions that already encode what
    // may be listed. listed_tutor_slugs() = listed + 100% + fee + NOT a seed
    // account; indexable_job_slugs() = open, real public_slug, NOT a fixture
    // (seed parent / JOB-TRK / SEED-JOB) unless a genuine team post. These are
    // the SQL mirror of lib/seo/indexable (PR37). `jobs` is public-read but
    // `profiles` is not, so the fixture rule needs definer rights here.
    const [{ data: t }, { data: j }] = await Promise.all([
      supabase.rpc('listed_tutor_slugs'),
      supabase.rpc('indexable_job_slugs'),
    ])
    tutors = (t ?? []) as typeof tutors
    jobs = (j ?? []) as typeof jobs
    landing = (await liveLandingPages()) as typeof landing
    posts = await publishedSlugs()
  } catch {
    // Leave the arrays empty; the static pages are still worth serving.
  }

  // Real per-page freshness signals (PR38 §3).
  const newestPost = newest(posts.map((p) => p.updatedAt))
  const newestTutor = newest(tutors.map((t) => t.updated_at))
  const newestJob = newest(jobs.map((j) => j.created_at))
  // A landing page reflects its listings, so it changed no later than the newest
  // listing of either kind.
  const newestListing = newest([
    newestTutor?.toISOString() ?? null,
    newestJob?.toISOString() ?? null,
  ])

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: STATIC_LASTMOD, changeFrequency: 'daily', priority: 1.0 },
    // Data-backed: the browse pages change with their newest listing.
    { url: `${BASE}/browse/tutors`, lastModified: newestTutor ?? STATIC_LASTMOD, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/browse/tuitions`, lastModified: newestJob ?? STATIC_LASTMOD, changeFrequency: 'daily', priority: 0.9 },
    // NOT listed here, deliberately (owner, 9 Sep 2026): /register is disallowed
    // in robots.ts and noindexed by its own layout. /membership-plans?for=… are
    // price/conversion pages, crawlable but never indexed (their own robots meta).
    // /login and /forgot-password were never listed. See robots-vs-sitemap.
    { url: `${BASE}/about`, lastModified: STATIC_LASTMOD, changeFrequency: 'monthly', priority: 0.4 },
    // Data-backed: the blog index changes when a post is published/updated.
    { url: `${BASE}/blog`, lastModified: newestPost ?? STATIC_LASTMOD, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/faq`, lastModified: STATIC_LASTMOD, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/support`, lastModified: STATIC_LASTMOD, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: STATIC_LASTMOD, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, lastModified: STATIC_LASTMOD, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Records keep their own real updated times (PR37).
  const tutorPages: MetadataRoute.Sitemap = tutors.map((t) => ({
    url: `${BASE}/tutor/${t.slug}`,
    lastModified: t.updated_at ? new Date(t.updated_at) : STATIC_LASTMOD,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  const jobPages: MetadataRoute.Sitemap = jobs.map((j) => ({
    url: `${BASE}/tuitions/${citySegment(j.city)}/${j.public_slug}`,
    lastModified: j.created_at ? new Date(j.created_at) : STATIC_LASTMOD,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }))

  const landingPages: MetadataRoute.Sitemap = landing.map((p) => ({
    url: `${BASE}/${p.kind}/${p.citySlug}/${p.subjectSlug}`,
    lastModified: newestListing ?? STATIC_LASTMOD,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }))

  const postPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: p.updatedAt ? new Date(p.updatedAt) : STATIC_LASTMOD,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }))

  return [...staticPages, ...tutorPages, ...jobPages, ...landingPages, ...postPages]
}
