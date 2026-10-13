import 'server-only'

// lib/schoolSearch.ts
//
// The server half of school-name search (owner, 13 Oct 2026): match what was
// typed against the school dictionary (lib/schoolSearchCore) and, when a school
// page exists for it (/tuition-jobs/school/<slug> — at least one open post names
// the school), return the row to show. No page is created here: the row only
// ever links to a page that already renders.

import { unstable_cache } from 'next/cache'

import { slugify } from '@/lib/slugs'
import { LANDING_TAG } from '@/lib/landing'
import { createPublicClient } from '@/lib/supabase/public'
import { schoolDictionary, schoolGroups, schoolHubPath } from '@/lib/schoolJobs'
import { matchSchool, schoolRowLabel } from '@/lib/schoolSearchCore'

/** Every school a post names today, with its cities. Ten minutes: this runs per keystroke. */
const groupsCached = unstable_cache(async () => schoolGroups(), ['school-search-groups'], { revalidate: 600, tags: [LANDING_TAG] })

export type SchoolSuggestion = {
  /** The school's name as we know it. */
  name: string
  /** "Tutors and tuitions for <School>". */
  label: string
  /** The school's page, or null when no open post names it (nothing to link). */
  href: string | null
  /** Open posts on that page. */
  openPosts: number
  /** Tutors in the school's first city, when that city has listed tutors. */
  tutorsHref: string | null
  tutorsCity: string | null
}

/** The school a search names, or null. Never throws. */
export async function schoolSuggestionFor(query: string | null | undefined): Promise<SchoolSuggestion | null> {
  try {
    const hit = matchSchool(query, await schoolDictionary())
    if (!hit) return null
    const slug = slugify(hit.name)
    const group = (await groupsCached()).find((g) => g.slug === slug) ?? null
    let tutorsHref: string | null = null
    let tutorsCity: string | null = null
    const city = group?.cities[0] ?? null
    if (city) {
      const { count } = await createPublicClient().from('tutor_directory').select('id', { count: 'exact', head: true }).ilike('city', city)
      if ((count ?? 0) > 0) {
        tutorsCity = city
        tutorsHref = `/browse/tutors?city=${encodeURIComponent(city)}`
      }
    }
    return {
      name: group?.name ?? hit.name,
      label: schoolRowLabel(group?.name ?? hit.name),
      href: group ? schoolHubPath(group.slug) : null,
      openPosts: group?.jobIds.length ?? 0,
      tutorsHref,
      tutorsCity,
    }
  } catch {
    return null
  }
}
