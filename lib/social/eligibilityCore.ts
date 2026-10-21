// lib/social/eligibilityCore.ts
//
// WHO MAY APPEAR IN A SOCIAL POST (owner, 21 Oct 2026). PURE — no imports — so the
// admin picker, the render route and the tests read one rule.
//
// A post goes to Facebook and Instagram under "Verified" wording, so only a
// tutor who IS verified may appear:
//   - the Verification Fee is paid (tutor_profiles.verified_fee_paid_at is set —
//     an approved payment and an Owner-granted badge both stamp it);
//   - staff have APPROVED the CNIC (lib/cnicStatus 'approved': marker + number +
//     image), the profile photo and the selfie;
//   - the account is not suspended, banned or paused by the member;
//   - it is not a fixture or a test account (seed, the team account, a hidden or
//     test-named account) — those were never promotable and still are not.
// Everyone else is left out of the picker and refused by the render route.

import { deriveCnicStatus } from '@/lib/cnicStatus'

export type SocialEligibilityFacts = {
  role: string | null | undefined
  feePaid: boolean
  cnicApproved: boolean
  photoApproved: boolean
  selfieApproved: boolean
  suspended?: boolean | null
  banned?: boolean | null
  selfPaused?: boolean | null
  isSeed?: boolean | null
  isTeam?: boolean | null
  isTest?: boolean | null
}

export type SocialIneligibleReason =
  | 'not_tutor'
  | 'fixture'
  | 'suspended'
  | 'banned'
  | 'paused'
  | 'fee_unpaid'
  | 'cnic_not_approved'
  | 'photo_not_approved'
  | 'selfie_not_approved'

/** The first reason this tutor may not be posted, or null when they may. */
export function socialIneligibleReason(f: SocialEligibilityFacts): SocialIneligibleReason | null {
  if ((f.role ?? '') !== 'tutor') return 'not_tutor'
  if (f.isSeed || f.isTeam || f.isTest) return 'fixture'
  if (f.banned) return 'banned'
  if (f.suspended) return 'suspended'
  if (f.selfPaused) return 'paused'
  if (!f.feePaid) return 'fee_unpaid'
  if (!f.cnicApproved) return 'cnic_not_approved'
  if (!f.photoApproved) return 'photo_not_approved'
  if (!f.selfieApproved) return 'selfie_not_approved'
  return null
}

export function socialEligible(f: SocialEligibilityFacts): boolean {
  return socialIneligibleReason(f) === null
}

/** What the render route answers for a tutor who may not be posted. */
export const NOT_VERIFIED_MESSAGE = 'Only verified tutors can be posted.'

// ---- reading the rows (pure; lib/social/eligibility.ts does the I/O) -------

export type SocialTutorFacts = SocialEligibilityFacts & {
  id: string
  gender: string | null
  /** tutor_profiles.show_avatar === false — "Hide my photo from parents". */
  photoHidden: boolean
}

export const PROFILE_COLS =
  'id, role, is_seed, is_team_account, is_test_name, hidden_from_public, is_suspended, is_banned, paused_by_user_at, verification_state, cnic_verified_at, cnic_number, cnic_image_path, profile_pic_status, selfie_status'

export type ProfileRow = Record<string, unknown> & { id: string }

export function toFacts(p: ProfileRow, tp: Record<string, unknown> | undefined): SocialTutorFacts {
  return {
    id: p.id,
    role: (p.role as string) ?? null,
    feePaid: !!tp?.verified_fee_paid_at,
    cnicApproved:
      deriveCnicStatus({
        verification_state: p.verification_state as string | null,
        cnic_verified_at: p.cnic_verified_at as string | null,
        cnic_number: p.cnic_number as string | null,
        cnic_image_path: p.cnic_image_path as string | null,
      }) === 'approved',
    photoApproved: String(p.profile_pic_status ?? '').toLowerCase() === 'approved',
    selfieApproved: String(p.selfie_status ?? '').toLowerCase() === 'approved',
    suspended: !!p.is_suspended,
    banned: !!p.is_banned,
    selfPaused: !!p.paused_by_user_at,
    isSeed: !!p.is_seed,
    isTeam: !!p.is_team_account,
    isTest: !!p.is_test_name || !!p.hidden_from_public,
    gender: (tp?.gender as string | null) ?? null,
    photoHidden: tp?.show_avatar === false,
  }
}

