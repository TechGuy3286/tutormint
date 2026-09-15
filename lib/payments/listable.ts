// lib/payments/listable.ts
//
// "Is this tutor LISTED?" — used by the payment go-live path to decide when a
// paused, paid Premium/Featured plan should start its clock.
//
// Under the one-time-fee model (owner, 15 Sep 2026) a tutor is listed once the
// Rs 199 verification fee is recorded and the precondition holds (mobile
// verified, verification not suspended/rejected, not suspended/banned/under
// review, claimed if imported). That is exactly tutorListed(). A tutor who buys
// Premium is normally already listed (they paid the fee first), so the plan
// activates immediately; a Premium bought before the fee pauses until the fee
// lands, and activatePayment's fee branch then starts it.

import { createAdminClient } from '@/lib/supabase/admin'
import { tutorListed } from '@/lib/planBadges'

export async function isTutorListable(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false

  const [{ data: prof }, { data: tp }] = await Promise.all([
    admin.from('profiles').select('phone_verified_at, is_suspended, is_banned').eq('id', userId).maybeSingle(),
    admin
      .from('tutor_profiles')
      .select('verification_status, under_review, imported, claimed_at, verified_fee_paid_at')
      .eq('id', userId)
      .maybeSingle(),
  ])
  if (!prof || !tp) return false

  return tutorListed({
    feePaid: !!tp.verified_fee_paid_at,
    phoneVerified: !!prof.phone_verified_at,
    verificationStatus: tp.verification_status as string | null,
    isSuspended: prof.is_suspended as boolean | null,
    isBanned: prof.is_banned as boolean | null,
    underReview: tp.under_review as boolean | null,
    imported: tp.imported as boolean | null,
    claimedAt: tp.claimed_at as string | null,
  })
}
