import type { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/public'
import { citySegment } from '@/lib/slugs'
import { PREVIEW_MODE } from '@/lib/preview'
import { SITE_URL } from '@/lib/siteUrl'

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

export const revalidate = 3600

const BASE = SITE_URL

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE}/browse/tutors`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/browse/tuitions`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tutor/packages`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/parent/packages`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/support`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // While the site is noindex, listing individual tutors and tuitions would be
  // a mixed signal -- robots.txt already withholds the sitemap for the same
  // reason. The static pages stay so the file is valid rather than empty.
  if (PREVIEW_MODE) return staticPages

  try {
    const supabase = createPublicClient()

    const [{ data: tutors }, { data: jobs }] = await Promise.all([
      supabase.rpc('listed_tutor_slugs'),
      supabase
        .from('jobs')
        .select('public_slug, city, created_at')
        .eq('status', 'open')
        .not('public_slug', 'is', null),
    ])

    const tutorPages: MetadataRoute.Sitemap = (
      (tutors ?? []) as { slug: string; updated_at: string }[]
    ).map((t) => ({
      url: `${BASE}/tutor/${t.slug}`,
      lastModified: t.updated_at ? new Date(t.updated_at) : now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

    const jobPages: MetadataRoute.Sitemap = (
      (jobs ?? []) as { public_slug: string; city: string | null; created_at: string }[]
    ).map((j) => ({
      url: `${BASE}/tuitions/${citySegment(j.city)}/${j.public_slug}`,
      lastModified: j.created_at ? new Date(j.created_at) : now,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }))

    return [...staticPages, ...tutorPages, ...jobPages]
  } catch {
    // A database blip must not produce a 500 for the crawler; the static
    // pages are still worth serving.
    return staticPages
  }
}
