import 'server-only'
import { revalidatePath } from 'next/cache'
import { citySegment } from '@/lib/slugs'
import { createAdminClient } from '@/lib/supabase/admin'

// On-demand rebuilds of the cached public pages (push 3, owner 1 Nov 2026).
//
// Public pages are cached for everyone (ISR) with a short time limit; when the
// data behind one changes, the code that changed it calls one of these so the
// next visitor gets the new page at once instead of after the time limit. A
// revalidatePath is only a mark — the page is rebuilt on its next request —
// so these are cheap and safe to over-call. Each is wrapped in try/catch: the
// same helpers run from scripts, where there is no request to revalidate in.

function mark(path: string, type?: 'page' | 'layout'): void {
  try {
    revalidatePath(path, type)
  } catch {
    /* not in a request scope (script) — nothing to revalidate */
  }
}

/** A tuition changed (posted, edited, paused, resumed, refreshed, closed, hired,
 *  merged): its own page, its city's hubs (city, female, online, areas), the
 *  school hubs and the homepage's "Newest tuitions". */
export function revalidatePublicTuition(job: { public_slug?: string | null; city?: string | null }): void {
  if (job.public_slug) mark(`/tuitions/${citySegment(job.city)}/${job.public_slug}`)
  if (job.city) mark(`/tuition-jobs/${citySegment(job.city)}`, 'layout')
  mark('/tuition-jobs/school/[school]', 'page')
  mark('/')
}

/** A listing changed in a way that can change which tutors a page shows (fee,
 *  moderation, pause, merge, erase): every tutor landing page and profile. */
export function revalidatePublicTutors(): void {
  mark('/tutors/[city]/[subject]', 'page')
  mark('/tutor/[slug]', 'page')
}

/** One tutor's profile changed (a save, a document decision, a photo). */
export async function revalidateTutorProfile(tutorId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data } = await admin.from('tutor_profiles').select('slug').eq('id', tutorId).maybeSingle()
    if (data?.slug) mark(`/tutor/${data.slug as string}`)
  } catch {
    /* a missed rebuild only means the time limit applies */
  }
}
