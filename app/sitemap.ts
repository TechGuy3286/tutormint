import type { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/public'

// The sitemap must list every listed tutor slug and every open job.
//
// The version this replaced listed five URLs, three of which were login pages
// -- pages we do not want indexed at all -- and no tutor or job. Those are the
// only pages with organic-search value on the whole site.
//
// Tutor slugs come from listed_tutor_slugs(), a SECURITY DEFINER function:
// tutor_profiles is owner-or-admin under RLS, so a plain select here would
// return nothing and the sitemap would silently ship empty.
//
// Job URLs are included for jobs that are open; the job detail page lands in
// T5, so entries point at the browse surface that renders them today.

export const revalidate = 3600

const BASE = 'https://tutormint.org'

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

  try {
    const supabase = createPublicClient()

    const [{ data: tutors }, { data: jobs }] = await Promise.all([
      supabase.rpc('listed_tutor_slugs'),
      supabase.from('jobs').select('job_tx_id, id, created_at').eq('status', 'open'),
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
      (jobs ?? []) as { job_tx_id: string | null; id: string; created_at: string }[]
    ).map((j) => ({
      url: `${BASE}/browse/tuitions?job=${j.job_tx_id ?? j.id}`,
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
