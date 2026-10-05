import 'server-only'

import { after } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'

// The one-time "✓ You're verified!" banner (owner, 5 Oct 2026).
//
// Decides whether THIS dashboard render is the first visit after the Verified
// badge was assigned, and — when it is — records the showing on the server
// (tutor_profiles.verified_banner_seen_at, migration 135) after the response is
// sent, so it never shows again on any device. One read, one deferred write.
//
// Works whether or not the column exists yet: a select that fails (column
// missing, migration not applied) reads as "already seen" and shows nothing —
// repeating the banner on every visit is the failure mode to avoid. A stamp that
// fails is logged and the next visit may show it once more; that is the lesser
// error than never recording.

export async function firstVerifiedVisit(userId: string, verified: boolean): Promise<boolean> {
  if (!verified) return false
  const admin = createAdminClient()
  if (!admin) return false

  const { data, error } = await admin
    .from('tutor_profiles')
    .select('verified_banner_seen_at')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return false
  if (data.verified_banner_seen_at) return false

  after(async () => {
    const { error: upErr } = await admin
      .from('tutor_profiles')
      .update({ verified_banner_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .is('verified_banner_seen_at', null)
    if (upErr) console.warn('[verified-banner] could not record the showing:', upErr.message)
  })
  return true
}
