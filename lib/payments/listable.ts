// lib/payments/listable.ts
//
// "May this tutor's paid plan start its clock?" — used by the payment go-live
// path to decide when a paused, paid Premium/Featured plan should begin.
//
// PR16 §1.5: the clock starts when the tutor is VISIBLE (the new directory rule:
// mobile, city, area, subjects, gender — `directoryBlockers`) AND the one-time
// verification fee is PAID. Visibility no longer includes the fee, so this asks
// for both explicitly — a Premium plan bought before the fee is paid stays paused
// until both are true, so nobody's 30 days run while they are unverified.
//
// No deadlock: neither the fee nor the visibility fields depend on the plan being
// started, so asking here never waits on the very plan being started.

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
      .select('verified_fee_paid_at, city, area, gender, verification_status, under_review, imported, claimed_at')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('tutor_subjects').select('tutor_id').eq('tutor_id', userId).limit(1),
  ])
  if (!prof || !tp) return false

  // The fee is required for the clock (PR16 §1.5) — separately from visibility.
  if (!tp.verified_fee_paid_at) return false

  return (
    directoryBlockers({
      phoneVerified: !!prof.phone_verified_at,
      hasSubjects: (subj ?? []).length > 0,
      city: (tp.city as string | null) ?? null,
      area: (tp.area as string | null) ?? null,
      gender: (tp.gender as string | null) ?? null,
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
