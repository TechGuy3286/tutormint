// lib/completion.ts
//
// Server-side recompute-and-persist for profiles.profile_completion.
// Every route that writes profile data calls recomputeCompletion() afterwards,
// so the stored percentage can never drift from what the checklist says.

import { createClient } from '@/lib/supabase/server'
import {
  calculateParentCompletion,
  calculateTutorCompletion,
  type Completion,
} from '@/lib/profileChecklist'

/**
 * Works out the checklist from live data WITHOUT writing anything.
 *
 * Split out of recomputeCompletion so a page can show a tutor where they stand
 * without persisting a side effect. That mattered: the dashboard used to call
 * the writing version on every render, which meant simply opening the
 * dashboard could rewrite profile_completion and, because listing is keyed on
 * that column, drop a tutor out of the public directory as a side effect of
 * looking at a page. Reads read; writes write.
 */
export async function computeCompletion(userId: string): Promise<Completion | null> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, role, full_name, city, address, cnic_number, cnic_image_path, phone_verified_at',
    )
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return null

  let completion: Completion

  if (profile.role === 'tutor') {
    const { data: tutorProfile } = await supabase
      .from('tutor_profiles')
      .select(
        'gender, area, avatar_url, headline, bio, experience_years, hourly_rate_pkr, teaching_mode, job_types, degrees, video_youtube_id, video_status, verified_fee_paid_at',
      )
      .eq('id', userId)
      .maybeSingle()

    const { count: subjectCount } = await supabase
      .from('tutor_subjects')
      .select('master_id', { count: 'exact', head: true })
      .eq('tutor_id', userId)

    const { count: degreeDocCount } = await supabase
      .from('user_documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('kind', 'degree')

    completion = calculateTutorCompletion({
      profile,
      tutorProfile,
      subjectCount: subjectCount ?? 0,
      degreeDocCount: degreeDocCount ?? 0,
      feePaid: !!(tutorProfile as { verified_fee_paid_at?: string | null } | null)?.verified_fee_paid_at,
    })
  } else {
    completion = calculateParentCompletion({ profile })
  }

  return completion
}

/**
 * Recalculates and PERSISTS profiles.profile_completion.
 *
 * Called from routes that write profile data, so the stored percentage can
 * never drift from what the checklist says. Never call this from a page
 * render.
 */
export async function recomputeCompletion(userId: string): Promise<Completion | null> {
  const completion = await computeCompletion(userId)
  if (!completion) return null

  const supabase = await createClient()
  await supabase
    .from('profiles')
    .update({ profile_completion: completion.percent })
    .eq('id', userId)

  // Start a paused plan the moment the tutor becomes LISTED. Since listing no
  // longer requires 100% completion (migration 86/87 — the fee lists, completion
  // only ranks/indexes), and the directory rule now includes having a subject and
  // a city (PR 3b §1), a tutor can cross into the directory at any completion
  // level — most often by adding the subject or city that was missing. So this
  // runs on every recompute, not only at 100%. Idempotent and cheap: it does
  // anything only for a tutor who is now in the directory AND holds a paused
  // subscription (it checks the role and the paused row itself), so it is safe to
  // call for anyone. A dynamic import keeps the payments module out of the many
  // write routes that call recomputeCompletion but never touch a plan.
  {
    const { activatePausedIfListed } = await import('@/lib/payments/goLive')
    await activatePausedIfListed(userId)
  }

  // A completion change can list or unlist a tutor, which opens or closes their
  // (city, subject) landing pages. Mark the landing cache stale so the pages,
  // the sitemap and the link helper pick it up. Cheap and idempotent.
  const { revalidateLanding } = await import('@/lib/landingRevalidate')
  revalidateLanding()

  return completion
}
