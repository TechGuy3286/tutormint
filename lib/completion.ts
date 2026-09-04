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
        'gender, area, avatar_url, headline, bio, experience_years, hourly_rate_pkr, teaching_mode, degrees, video_youtube_id, video_status',
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

  // Reaching 100% is the usual way a tutor goes live, so this is the natural
  // place to start a plan they bought while under it. Idempotent and cheap: it
  // only does anything for a tutor who now appears in the directory AND holds a
  // paused subscription. A dynamic import keeps the payments module out of the
  // many write routes that call recomputeCompletion but never touch a plan.
  if (completion.percent >= 100) {
    const { activatePausedIfListed } = await import('@/lib/payments/goLive')
    await activatePausedIfListed(userId)
  }

  return completion
}
