// lib/payments/listable.ts
//
// "Would this tutor be listed if their plan were running?" — the listing rule
// MINUS the plan.
//
// Since 10 Sep 2026 a tutor is listed only with an ACTIVE paid plan, so the
// payment path can no longer ask tutor_directory "are you listed?" to decide
// when a paused, paid plan should start its clock: the plan being activated is
// the very thing the directory is waiting on, so the answer would always be no
// and the clock would never start. The right question is the PRECONDITION —
// mobile verified, verification 'verified', not suspended/banned/under-review,
// claimed if imported — which lib/planBadges.ts owns as a pure function. When it
// holds, activating the paused plan is exactly what makes the tutor listed.

import { createAdminClient } from '@/lib/supabase/admin'
import { tutorListablePrecondition } from '@/lib/planBadges'

export async function isTutorListable(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false

  const [{ data: prof }, { data: tp }] = await Promise.all([
    admin.from('profiles').select('phone_verified_at, is_suspended, is_banned').eq('id', userId).maybeSingle(),
    admin
      .from('tutor_profiles')
      .select('verification_status, under_review, imported, claimed_at')
      .eq('id', userId)
      .maybeSingle(),
  ])
  if (!prof || !tp) return false

  return tutorListablePrecondition({
    phoneVerified: !!prof.phone_verified_at,
    verificationStatus: tp.verification_status as string | null,
    isSuspended: prof.is_suspended as boolean | null,
    isBanned: prof.is_banned as boolean | null,
    underReview: tp.under_review as boolean | null,
    imported: tp.imported as boolean | null,
    claimedAt: tp.claimed_at as string | null,
  })
}
