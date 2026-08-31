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
 * Recalculates the completion percentage for a user from live data and writes
 * it to profiles.profile_completion. Returns the full checklist so callers can
 * hand it straight back to the client.
 */
export async function recomputeCompletion(userId: string): Promise<Completion | null> {
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

  await supabase
    .from('profiles')
    .update({ profile_completion: completion.percent })
    .eq('id', userId)

  return completion
}
