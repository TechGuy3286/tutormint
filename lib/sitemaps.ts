// lib/sitemaps.ts
//
// The four sitemap files, read LIVE on every fetch (owner, 12 Oct 2026). The
// rules — what may be listed — are in lib/sitemapCore; this file only loads the
// candidates. Every read goes through the same SECURITY DEFINER functions and
// live counts the pages themselves use, so a URL is listed exactly while its own
// page is indexable. A database blip leaves a file short, never a 500.

import 'server-only'

import { pageAll } from '@/lib/pageAll'
import { createPublicClient } from '@/lib/supabase/public'
import { citySegment } from '@/lib/slugs'
import { SITE_URL } from '@/lib/siteUrl'
import { cityPages, cityPagePath, CITY_PAGE_THRESHOLD } from '@/lib/cityJobs'
import { schoolGroups, schoolHubPath, SCHOOL_HUB_THRESHOLD } from '@/lib/schoolJobs'
import { liveCombinationsAllUncached, LANDING_THRESHOLD } from '@/lib/landing'
import { liveOverlapNoindex, overlapKey } from '@/lib/landingOverlap'
import { publishedSlugs } from '@/lib/blogFeed'
import { openRepeatSlugs } from '@/lib/duplicates'
import {
  cleanEntries,
  hubSitemapEntries,
  newestOf,
  tuitionSitemapEntries,
  tutorSitemapEntries,
  type HubCandidate,
  type SitemapEntry,
  type SitemapFile,
} from '@/lib/sitemapCore'

const BASE = SITE_URL

// The code-only pages (home, about, faq, support, legal) change only when their
// code changes, so they carry a stored date rather than "now" on every fetch.
// Bump it when that content changes.
const STATIC_LASTMOD = new Date('2026-10-13T00:00:00.000Z')

/** Open tuitions, and paused ones paused in the last 60 days (owner, 16 Oct
 *  2026); lastmod = the tuition's last change (posted, resumed, refreshed, paused). */
export async function tuitionSitemap(): Promise<SitemapEntry[]> {
  const db = createPublicClient()
  // indexable_tuitions() (migration 178) = open, or paused within 60 days + a
  // real slug + not merged + not a fixture/test + not a one-line post — the SQL
  // mirror of tuitionIndexable.
  const [rows, repeats] = await Promise.all([
    pageAll((from, to) => db.rpc('indexable_tuitions').order('public_slug').range(from, to)) as Promise<
      {
        public_slug: string
        city: string | null
        status: string
        created_at: string
        resumed_at: string | null
        refreshed_at: string | null
        bumped_at: string | null
        paused_at: string | null
      }[]
    >,
    // A real repeat of an older open tuition points its canonical at the
    // original (lib/duplicates), so it is never listed (owner, 13 Oct 2026).
    openRepeatSlugs().catch(() => new Map<string, unknown>()),
  ])
  return tuitionSitemapEntries(
    BASE,
    rows.filter((r) => !repeats.has(r.public_slug)).map((r) => ({
      path: `/tuitions/${citySegment(r.city)}/${r.public_slug}`,
      status: r.status,
      pausedAt: r.paused_at,
      isFixture: false,
      descriptionLength: 40,
      lastmod: newestOf([r.created_at, r.resumed_at, r.refreshed_at, r.bumped_at, r.paused_at])?.toISOString() ?? r.created_at,
    })),
  )
}

/** Indexable tutor profiles only: fee paid + CNIC, photo and selfie approved. */
export async function tutorSitemap(): Promise<SitemapEntry[]> {
  const db = createPublicClient()
  // listed_tutor_slugs() is the SQL mirror of tutorProfileIndexable, built on
  // tutor_directory (so paused, banned, hidden, test and rejected are out).
  const rows = (await pageAll((from, to) => db.rpc('listed_tutor_slugs').order('slug').range(from, to))) as {
    slug: string
    updated_at: string | null
  }[]
  return tutorSitemapEntries(
    BASE,
    rows.map((r) => ({
      path: `/tutor/${r.slug}`,
      feePaid: true,
      cnicApproved: true,
      profilePicApproved: true,
      selfieApproved: true,
      lastmod: r.updated_at,
    })),
  )
}

/** Published posts. */
export async function blogSitemap(): Promise<SitemapEntry[]> {
  const posts = await publishedSlugs()
  return cleanEntries(
    posts.map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastmod: p.updatedAt ?? STATIC_LASTMOD, changefreq: 'monthly' as const, priority: 0.5 })),
    BASE,
  )
}

/** The static pages and every hub that clears its rule. */
export async function pagesSitemap(): Promise<SitemapEntry[]> {
  const [tuitions, tutors, posts] = await Promise.all([
    tuitionSitemap().catch(() => []),
    tutorSitemap().catch(() => []),
    publishedSlugs().catch(() => []),
  ])
  const newestJob = newestOf(tuitions.map((t) => t.lastmod)) ?? STATIC_LASTMOD
  const newestTutor = newestOf(tutors.map((t) => t.lastmod)) ?? STATIC_LASTMOD
  const newestPost = newestOf(posts.map((p) => p.updatedAt)) ?? STATIC_LASTMOD

  const statics: SitemapEntry[] = [
    { url: BASE, lastmod: STATIC_LASTMOD, changefreq: 'daily', priority: 1.0 },
    { url: `${BASE}/browse/tutors`, lastmod: newestTutor, changefreq: 'daily', priority: 0.9 },
    { url: `${BASE}/browse/tuitions`, lastmod: newestJob, changefreq: 'daily', priority: 0.9 },
    // The clean address only — its ?for=…&plan=… variants point their canonical here.
    { url: `${BASE}/membership-plans`, lastmod: STATIC_LASTMOD, changefreq: 'monthly', priority: 0.4 },
    // The public "Post your tuition" page every parent message links to (28 Oct 2026).
    { url: `${BASE}/post-tuition`, lastmod: STATIC_LASTMOD, changefreq: 'monthly', priority: 0.6 },
    { url: `${BASE}/about`, lastmod: STATIC_LASTMOD, changefreq: 'monthly', priority: 0.4 },
    { url: `${BASE}/blog`, lastmod: newestPost, changefreq: 'daily', priority: 0.6 },
    { url: `${BASE}/faq`, lastmod: STATIC_LASTMOD, changefreq: 'monthly', priority: 0.4 },
    { url: `${BASE}/support`, lastmod: STATIC_LASTMOD, changefreq: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, lastmod: STATIC_LASTMOD, changefreq: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, lastmod: STATIC_LASTMOD, changefreq: 'yearly', priority: 0.2 },
  ]

  const hubs: HubCandidate[] = []
  try {
    const [cities, schools, landing, overlap] = await Promise.all([
      cityPages(),
      schoolGroups(),
      liveCombinationsAllUncached(),
      liveOverlapNoindex(),
    ])
    for (const c of cities) {
      hubs.push({ path: cityPagePath(c.citySlug), count: c.count, threshold: CITY_PAGE_THRESHOLD, lastmod: newestJob, priority: 0.8 })
      for (const v of c.variants) {
        hubs.push({ path: cityPagePath(c.citySlug, v.slug), count: v.count, threshold: CITY_PAGE_THRESHOLD, lastmod: newestJob })
      }
    }
    for (const s of schools) {
      hubs.push({ path: schoolHubPath(s.slug), count: s.jobIds.length, threshold: SCHOOL_HUB_THRESHOLD, lastmod: newestJob })
    }
    for (const p of landing) {
      hubs.push({
        path: `/${p.kind}/${p.citySlug}/${p.subjectSlug}`,
        // A tutor page counts VERIFIED tutors; a tuition page counts open tuitions.
        count: p.kind === 'tutors' ? (p.verified ?? 0) : p.count,
        threshold: LANDING_THRESHOLD,
        overlap: overlap.has(overlapKey(p.kind, p.citySlug, p.masterId)),
        lastmod: p.kind === 'tutors' ? newestTutor : newestJob,
      })
    }
  } catch {
    // The static pages are still worth serving.
  }
  return [...cleanEntries(statics, BASE), ...hubSitemapEntries(BASE, hubs)]
}

export async function sitemapEntries(file: SitemapFile): Promise<SitemapEntry[]> {
  try {
    if (file === 'tuitions') return await tuitionSitemap()
    if (file === 'tutors') return await tutorSitemap()
    if (file === 'blog') return await blogSitemap()
    return await pagesSitemap()
  } catch {
    return []
  }
}
