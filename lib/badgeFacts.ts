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
  return (await loadCardTrustFacts(ids)).verifiedOk
}

export type CardTrustFacts = {
  /** The Verified badge (lib/badgeRule). */
  verifiedOk: Set<string>
  /** Tutors whose CNIC staff APPROVED (lib/cnicStatus 'approved') — the public
   *  "CNIC verified" chip (owner, 17 Oct 2026). Never the number itself. */
  cnicApproved: Set<string>
  /** Tutors who chose "Hide my photo from parents" (tutor_profiles.show_avatar
   *  = false) — public surfaces show their initials (owner, 17 Oct 2026). */
  photoHidden: Set<string>
}

/** Everything a public tutor card needs about trust and privacy, in one batch. */
export async function loadCardTrustFacts(ids: string[]): Promise<CardTrustFacts> {
  const out = new Set<string>()
  const cnicApproved = new Set<string>()
  const photoHidden = new Set<string>()
  const admin = createAdminClient()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!admin || unique.length === 0) return { verifiedOk: out, cnicApproved, photoHidden }

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
    .select('id, verified_fee_paid_at, show_avatar')
    .in('id', unique)
  const feePaid = new Set((feeRows ?? []).filter((r) => r.verified_fee_paid_at).map((r) => r.id as string))
  for (const r of feeRows ?? []) if ((r as { show_avatar?: boolean | null }).show_avatar === false) photoHidden.add(r.id as string)

  for (const p of data ?? []) {
    const id = p.id as string
    if ((p.role as string) === 'tutor') {
      const d = tutorDocStatusesFromProfile(p, hasSelfieFile.has(id))
      if (tutorVerifiedBadgeOk(feePaid.has(id), d)) out.add(id)
      if (deriveCnicStatus(p) === 'approved') cnicApproved.add(id)
    } else {
      // Parent / academy: CNIC verified.
      if (p.cnic_verified_at) out.add(id)
    }
  }
  return { verifiedOk: out, cnicApproved, photoHidden }
}

/** Single-member convenience (own dashboard, public profile). */
export async function verifiedBadgeOkOne(id: string): Promise<boolean> {
  return (await loadVerifiedBadgeOk([id])).has(id)
}
