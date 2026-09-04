import { createClient } from '@/lib/supabase/server'

// The identity card's data, for either role.
//
// ONE SHAPE, BOTH ROLES, and that is the point. Before this a parent's CNIC
// lived in `user_documents` (private bucket, watermarked previews, served only
// through /api/documents/[id]/preview) while a tutor's lived in
// `tutor_profiles.cnic_front_url` — a PUBLIC URL in the tutor-media bucket,
// fetchable by anybody who had it, with no auth of any kind. Two flows, two
// storage models, and only one of them was safe. There is one now, and it is
// the private one.
//
// Everything here comes off `profiles` plus `user_documents`, which every role
// has. Nothing reads a tutor-specific column, so the same card renders on both
// dashboards without a branch.

export type IdentitySide = 'front' | 'back'

export type IdentityDoc = { id: string; side: IdentitySide; uploadedAt: string }

export type IdentityState = 'none' | 'submitted' | 'approved' | 'rejected'

export type Identity = {
  /** The full number. Masked at the point of display — see lib/cnic.ts. */
  cnicNumber: string | null
  state: IdentityState
  verifiedAt: string | null
  addressVerifiedAt: string | null
  rejectionReason: string | null
  front: IdentityDoc | null
  back: IdentityDoc | null
}

/**
 * `label` carries the side.
 *
 * A row written before the front/back split has no label, and it is the front:
 * that is what the single upload asked for, in copy that said "the front of
 * the card". Guessing the other way would put a back photo where a face
 * should be in the admin queue.
 */
function sideOf(label: string | null): IdentitySide {
  return label === 'back' ? 'back' : 'front'
}

export async function loadIdentity(userId: string): Promise<Identity> {
  const supabase = await createClient()

  const [{ data: profile }, { data: docs }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'cnic_number, cnic_verified_at, address_verified_at, verification_state, verification_rejection_reason',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('user_documents')
      .select('id, label, created_at')
      .eq('user_id', userId)
      .eq('kind', 'cnic')
      // Newest first, so a member who re-uploaded a blurry side sees the
      // replacement rather than the picture they replaced.
      .order('created_at', { ascending: false }),
  ])

  let front: IdentityDoc | null = null
  let back: IdentityDoc | null = null
  for (const d of docs ?? []) {
    const doc: IdentityDoc = {
      id: d.id as string,
      side: sideOf((d.label as string | null) ?? null),
      uploadedAt: d.created_at as string,
    }
    if (doc.side === 'back') back ??= doc
    else front ??= doc
  }

  const verifiedAt = (profile?.cnic_verified_at as string | null) ?? null
  const stored = (profile?.verification_state as IdentityState | null) ?? 'none'

  return {
    cnicNumber: (profile?.cnic_number as string | null) ?? null,
    // An approved card whose state column was never advanced still reads as
    // approved: three seed parents carry cnic_verified_at with state 'none',
    // and the timestamp is the fact that matters — it is what the badge and
    // the posting gate both key on.
    state: verifiedAt ? 'approved' : stored,
    verifiedAt,
    addressVerifiedAt: (profile?.address_verified_at as string | null) ?? null,
    rejectionReason: (profile?.verification_rejection_reason as string | null) ?? null,
    front,
    back,
  }
}
