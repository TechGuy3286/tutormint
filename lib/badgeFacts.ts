import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deriveCnicStatus } from '@/lib/cnicStatus'

// Who qualifies for the VERIFIED badge (PR105-B §1), in ONE batched query.
//
//   Tutor  → staff-approved CNIC AND photo AND selfie (the Rs 199 fee is implied
//            by the plan the caller passes — a tutor only holds basic/premium/
//            featured once the fee is paid).
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
    .select('id, role, cnic_verified_at, verification_state, cnic_number, cnic_image_path, profile_pic_status, selfie_status')
    .in('id', unique)

  for (const p of data ?? []) {
    if ((p.role as string) === 'tutor') {
      const cnicApproved =
        deriveCnicStatus({
          verification_state: (p.verification_state as string) ?? null,
          cnic_verified_at: (p.cnic_verified_at as string) ?? null,
          cnic_number: (p.cnic_number as string) ?? null,
          cnic_image_path: (p.cnic_image_path as string) ?? null,
        }) === 'approved'
      if (cnicApproved && p.profile_pic_status === 'approved' && p.selfie_status === 'approved') {
        out.add(p.id as string)
      }
    } else {
      // Parent / academy: CNIC verified.
      if (p.cnic_verified_at) out.add(p.id as string)
    }
  }
  return out
}

/** Single-member convenience (own dashboard, public profile). */
export async function verifiedBadgeOkOne(id: string): Promise<boolean> {
  return (await loadVerifiedBadgeOk([id])).has(id)
}
