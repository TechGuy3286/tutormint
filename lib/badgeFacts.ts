import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deriveCnicStatus } from '@/lib/cnicStatus'
import { tutorDocStatusesFromProfile } from '@/lib/tutorDocStatus'
import { tutorVerifiedBadgeOk } from '@/lib/badgeRule'

// Who qualifies for the VERIFIED badge, in ONE batched query, through the single
// shared rule (lib/badgeRule), so every surface agrees.
//
//   Tutor  → fee paid (verified_fee_paid_at) AND CNIC + photo + selfie all
//            SUBMITTED (with a file) AND none currently rejected. Staff approval
//            is NOT required (owner, PR106-H4) — a rejection pauses the badge.
//   Parent → CNIC verified (profiles.cnic_verified_at).
//
// Every list that shows badges fetches this ONCE for its member ids (no
// per-card query) and passes `ok.has(id)` to badgesForPlan as `verifiedOk`.

export async function loadVerifiedBadgeOk(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const admin = createAdminClient()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!admin || unique.length === 0) return out

  const { data } = await admin
    .from('profiles')
    .select('id, role, cnic_verified_at, verification_state, verification_rejection_reason, cnic_number, cnic_image_path, profile_pic_status, profile_pic_reason, selfie_status, selfie_reason, avatar_url')
    .in('id', unique)

  // Which tutors actually have a selfie FILE on record (PR106-E §5): a status
  // without a file must NOT earn the badge.
  const { data: selfieRows } = await admin
    .from('user_documents')
    .select('user_id')
    .eq('kind', 'selfie')
    .eq('status', 'active') // PR106-H3 §1.4 — ignore paused duplicate uploads
    .in('user_id', unique)
  const hasSelfieFile = new Set((selfieRows ?? []).map((r) => r.user_id as string))

  // Fee paid, per tutor — the badge rule needs it (self-contained, not relying
  // on the caller's plan gate).
  const { data: feeRows } = await admin
    .from('tutor_profiles')
    .select('id, verified_fee_paid_at')
    .in('id', unique)
  const feePaid = new Set((feeRows ?? []).filter((r) => r.verified_fee_paid_at).map((r) => r.id as string))

  for (const p of data ?? []) {
    const id = p.id as string
    if ((p.role as string) === 'tutor') {
      const d = tutorDocStatusesFromProfile(p, hasSelfieFile.has(id))
      if (tutorVerifiedBadgeOk(feePaid.has(id), d)) out.add(id)
    } else {
      // Parent / academy: CNIC verified.
      if (p.cnic_verified_at) out.add(id)
    }
  }
  return out
}

/** Single-member convenience (own dashboard, public profile). */
export async function verifiedBadgeOkOne(id: string): Promise<boolean> {
  return (await loadVerifiedBadgeOk([id])).has(id)
}
