// lib/schoolJobs.ts
//
// The school job hubs (owner, 12 Oct 2026): /tuition-jobs/school/<slug> lists
// the OPEN posts that name one school — "Beaconhouse teacher jobs", "NSSE jobs".
// Read LIVE from the open posts, so a hub appears by itself at 3 open posts and
// is noindex (and unlinked, and out of the sitemap) below that.
//
// Server-only. Anon may read open jobs and the taxonomy, so the public client
// is enough. The rules are pure, in lib/schoolJobsCore.

import 'server-only'

import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { pageAll } from '@/lib/pageAll'
import { testAccountIds } from '@/lib/testAccounts'
import { LANDING_TAG } from '@/lib/landing'
import {
  groupBySchool,
  knownSchools,
  schoolForJob,
  SCHOOL_HUB_THRESHOLD,
  type KnownSchool,
  type SchoolGroup,
  type SchoolMatch,
} from '@/lib/schoolJobsCore'

export { SCHOOL_HUB_THRESHOLD, schoolHubPath, schoolShortName, type SchoolGroup } from '@/lib/schoolJobsCore'

/** The Admission Test Prep schools in the taxonomy (the level with no grade). */
const taxonomySchools = unstable_cache(
  async (): Promise<{ name: string }[]> => {
    const db = createPublicClient()
    const { data: cats } = await db.from('taxonomy_categories').select('slug').eq('no_grade', true)
    const slugs = (cats ?? []).map((c) => c.slug as string)
    if (slugs.length === 0) return []
    const { data: master } = await db.from('taxonomy_master').select('subject_slug').in('category_slug', slugs)
    const subjectSlugs = [...new Set((master ?? []).map((m) => m.subject_slug as string | null).filter((s): s is string => !!s))]
    if (subjectSlugs.length === 0) return []
    const { data: subjects } = await db.from('taxonomy_subjects').select('name').in('slug', subjectSlugs)
    return (subjects ?? []).map((s) => ({ name: s.name as string }))
  },
  ['school-hub-taxonomy-schools'],
  { revalidate: 60 * 60 * 24 },
)

export async function schoolDictionary(): Promise<KnownSchool[]> {
  return knownSchools(await taxonomySchools().catch(() => []))
}

type OpenRow = { id: string; title: string | null; description: string | null; city: string | null; parent_id: string | null; jobTitle: string | null }

async function openPosts(): Promise<OpenRow[]> {
  const db = createPublicClient()
  const [rows, test] = await Promise.all([
    pageAll((from, to) =>
      db.from('jobs').select('id, title, description, city, parent_id, teaching_mode').eq('status', 'open').order('id').range(from, to),
    ),
    testAccountIds(),
  ])
  const hidden = new Set(test)
  return (rows as (Omit<OpenRow, 'jobTitle'> & { teaching_mode: string | null })[])
    .filter((r) => !r.parent_id || !hidden.has(r.parent_id))
    .map(({ teaching_mode, ...r }) => ({ ...r, jobTitle: teaching_mode }))
}

/** Every school named by at least one open post, busiest first. */
export async function schoolGroups(): Promise<SchoolGroup[]> {
  const [posts, known] = await Promise.all([openPosts(), schoolDictionary()])
  return groupBySchool(posts, known)
}

/** The hubs that clear the threshold — the sitemap and every link block. */
export async function indexableSchoolHubs(): Promise<SchoolGroup[]> {
  return (await schoolGroups()).filter((g) => g.jobIds.length >= SCHOOL_HUB_THRESHOLD)
}

/** For LINK BLOCKS only (a tuition page's link to its school hub): ten minutes. */
export const indexableSchoolHubsCached = unstable_cache(
  async (): Promise<SchoolGroup[]> => indexableSchoolHubs(),
  ['school-job-hubs'],
  { revalidate: 600, tags: [LANDING_TAG] },
)

export async function schoolGroupBySlug(slug: string): Promise<SchoolGroup | null> {
  return (await schoolGroups()).find((g) => g.slug === slug) ?? null
}

/** The school ONE post names (for its JobPosting and its link to the hub). */
export async function schoolOfJob(job: { title: string | null; description?: string | null; city?: string | null; jobTitle?: string | null }): Promise<SchoolMatch | null> {
  return schoolForJob(job, await schoolDictionary())
}
