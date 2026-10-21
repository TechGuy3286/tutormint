import 'server-only'

import { chunk, pageAll } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'
import { PROFILE_COLS, socialEligible, toFacts, type ProfileRow, type SocialTutorFacts } from './eligibilityCore'

export type { SocialTutorFacts }

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// Reads the facts lib/social/eligibilityCore.ts decides on, straight from the base
// tables on every request (no cache), so a tutor verified a moment ago appears at
// once. Also returns the two facts the picture needs: the profile gender (for the
// grey silhouette) and whether the tutor hid their photo from parents.

async function tutorRows(admin: Admin, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  for (const part of chunk(ids, 100)) {
    const { data, error } = await admin
      .from('tutor_profiles')
      .select('id, verified_fee_paid_at, gender, show_avatar')
      .in('id', part)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) out.set(r.id as string, r as Record<string, unknown>)
  }
  return out
}

/** Every tutor who may appear in a social post, with their picture facts. */
export async function loadSocialEligibleTutors(admin: Admin): Promise<Map<string, SocialTutorFacts>> {
  const profiles = (await pageAll<ProfileRow>((from, to) =>
    admin.from('profiles').select(PROFILE_COLS).eq('role', 'tutor').order('id').range(from, to) as never,
  )) as ProfileRow[]
  const tps = await tutorRows(admin, profiles.map((p) => p.id))
  const out = new Map<string, SocialTutorFacts>()
  for (const p of profiles) {
    const facts = toFacts(p, tps.get(p.id))
    if (socialEligible(facts)) out.set(p.id, facts)
  }
  return out
}

/** One tutor's facts (eligible or not), or null when there is no such profile. */
export async function loadSocialTutorFacts(admin: Admin, id: string): Promise<SocialTutorFacts | null> {
  const { data: p } = await admin.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()
  if (!p) return null
  const tps = await tutorRows(admin, [id])
  return toFacts(p as ProfileRow, tps.get(id))
}
