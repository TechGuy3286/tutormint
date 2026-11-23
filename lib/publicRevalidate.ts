import 'server-only'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { areaMarks, pathOfUrl, tuitionMarks, tutorListingMarks, tutorProfileMarks, tutorRatingMarks, type Mark } from '@/lib/publicRevalidateCore'
import { refreshRankCacheFor } from '@/lib/rankCache'
import { subjectMetaByMaster } from '@/lib/landing'
import { citySegment } from '@/lib/slugs'

// On-demand rebuilds of the cached public pages (push 3, owner 1 Nov 2026;
// PR-15). The pages are cached with a long safety-net time limit (hours —
// lib/publicRevalidateCore PUBLIC_REVALIDATE) and rebuilt here only when their
// own content changes; which pages each change marks is decided in
// lib/publicRevalidateCore (pure, tested). A revalidatePath is only a mark —
// the page is rebuilt on its next request. Each mark is wrapped in try/catch:
// the same helpers run from scripts, where there is no request scope.

/** Apply a list of marks (also used by lib/tutorLinkers, PR-16). */
export function applyMarks(marks: Mark[]): void {
  apply(marks)
}

function apply(marks: Mark[]): void {
  for (const m of marks) {
    try {
      revalidatePath(m.path, m.type)
    } catch {
      /* not in a request scope (script) — nothing to revalidate */
    }
  }
}

/** A tuition changed: its page, its city's hubs, school hubs, Browse
 *  tuitions and the homepage (lib/publicRevalidateCore tuitionMarks). */
export function revalidatePublicTuition(job: { public_slug?: string | null; city?: string | null }): void {
  apply(tuitionMarks(job))
}

/** A listing changed in a way that can change which tutors a landing page
 *  shows: the tutor landing pages and Browse tutors (not every profile). */
export function revalidatePublicTutors(): void {
  apply(tutorListingMarks())
}

/** A curated area or alias changed: every city's tuition hubs. */
export function revalidatePublicAreas(): void {
  apply(areaMarks())
}

/** One public page by its full URL (the nightly sweeps). */
export function revalidatePublicUrl(url: string): void {
  const path = pathOfUrl(url)
  if (path) apply([{ path }])
}

/** A tutor's rating changed (PR-17 Part B): refresh their ranking-cache row
 *  first (the rebuilt cards read it), then mark exactly the pages that show the
 *  rating (lib/publicRevalidateCore tutorRatingMarks). Never throws. */
export async function revalidateTutorRating(tutorId: string): Promise<void> {
  try {
    await refreshRankCacheFor([tutorId])
    const admin = createAdminClient()
    if (!admin) return
    const [{ data: tp }, { data: dir }, { data: subs }, meta] = await Promise.all([
      admin.from('tutor_profiles').select('slug').eq('id', tutorId).maybeSingle(),
      admin.from('tutor_directory').select('city, cities').eq('id', tutorId).maybeSingle(),
      admin.from('tutor_subjects').select('master_id').eq('tutor_id', tutorId),
      subjectMetaByMaster(),
    ])
    const cities = [dir?.city as string | null, ...(((dir?.cities as string[] | null) ?? []))].filter(Boolean).map((c) => citySegment(c as string))
    const subjects = (subs ?? []).map((s) => meta.get(Number(s.master_id))?.slug ?? '').filter(Boolean)
    apply(tutorRatingMarks((tp?.slug as string | null) ?? null, cities, subjects))
  } catch {
    /* a missed rebuild only means the time limit applies */
  }
}

/** One tutor's profile changed (a save, a document decision, a photo). */
export async function revalidateTutorProfile(tutorId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data } = await admin.from('tutor_profiles').select('slug').eq('id', tutorId).maybeSingle()
    apply(tutorProfileMarks((data?.slug as string | null) ?? null))
  } catch {
    /* a missed rebuild only means the time limit applies */
  }
}
