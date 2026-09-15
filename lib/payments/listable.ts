// lib/payments/listable.ts
//
// "Is this tutor LISTED?" — used by the payment go-live path to decide when a
// paused, paid Premium/Featured plan should start its clock.
//
// PR 3b §1: this now uses the FULL directory rule — `directoryBlockers`, the
// same pure function `ent.listed`, the dashboard and the admin list read, and a
// 1:1 mirror of the tutor_directory view (migration 87). Before, it asked only
// `tutorListed()` (the one-time fee + precondition), which does NOT check for a
// subject or a city — so a tutor with no subject or no city could have their
// paid Premium/Featured 30 days running while invisible in search. Now the clock
// starts only when they are genuinely in the directory.
//
// No deadlock: under the one-time-fee model (migration 86/87) listing keys on
// the Rs 199 fee, NOT on an active paid plan, so asking "am I in the directory?"
// here never waits on the very plan being started. (That deadlock reasoning
// belonged to the 10 Sep model, where listing required an active plan; it is
// stale and gone.)

import { createAdminClient } from '@/lib/supabase/admin'
import { directoryBlockers } from '@/lib/tutorListingStatus'

export async function isTutorListable(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false

  const [{ data: prof }, { data: tp }, { data: subj }] = await Promise.all([
    admin
      .from('profiles')
      .select('phone_verified_at, is_suspended, is_banned, is_seed, is_team_account')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('tutor_profiles')
      .select('verified_fee_paid_at, city, verification_status, under_review, imported, claimed_at')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('tutor_subjects').select('tutor_id').eq('tutor_id', userId).limit(1),
  ])
  if (!prof || !tp) return false

  return (
    directoryBlockers({
      feePaid: !!tp.verified_fee_paid_at,
      phoneVerified: !!prof.phone_verified_at,
      hasSubjects: (subj ?? []).length > 0,
      city: (tp.city as string | null) ?? null,
      verificationStatus: tp.verification_status as string | null,
      isSuspended: prof.is_suspended as boolean | null,
      isBanned: prof.is_banned as boolean | null,
      underReview: tp.under_review as boolean | null,
      imported: tp.imported as boolean | null,
      claimedAt: tp.claimed_at as string | null,
      isSeed: prof.is_seed as boolean | null,
      isTeamAccount: prof.is_team_account as boolean | null,
    }).length === 0
  )
}
