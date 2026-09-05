/**
 * scripts/seedCast.ts
 *
 * THE CANONICAL SEED CAST. One definition, read by three things: the reset
 * script that puts each account back to its intended state, the smoke test that
 * asserts an evidence run left the cast unchanged, and docs/SEED_CAST.md (kept
 * in step by hand from this table).
 *
 * WHY THIS EXISTS. The cast drifts. Every evidence run that flips a seed
 * account to Featured to photograph a Featured surface, or expires one to make
 * it free, leaves residue if the restore is forgotten or restores to the wrong
 * baseline. On 4 Sep 2026 five of nine cast members had drifted: two free
 * tutors carried a Premium plan, two "verified"/"premium" tutors were both on
 * Featured, a "verified, no plan" parent held parent_featured, and the
 * "unverified" parent had a verified CNIC and address. Naming the intended
 * state in one place makes the drift a diff.
 *
 * The intent is encoded so the cast matches its own names: seed+featured-ali is
 * a Featured tutor, seed+unverified-zain is an unverified parent, and so on.
 */

export type CastRole = 'tutor' | 'parent'

export type CastMember = {
  /** The local-part after `seed+`, e.g. 'featured-ali'. */
  key: string
  email: string
  role: CastRole
  /** The plan that should be ACTIVE, or null for no plan. */
  plan: string | null
  /** Tutors only: the intended verification_status. */
  verification?: 'verified' | 'pending' | 'suspended'
  /** Set on the suspended fixture only. */
  suspended?: boolean
  /** Parents: whether CNIC + address should read as approved. */
  parentVerified?: boolean
  /** The intended profile_completion, when the cast pins it. */
  completion?: number
  /** One line for docs/SEED_CAST.md and the reset log. */
  intent: string
}

const E = (k: string) => `seed+${k}@tutormint.dev`

/**
 * The nine named cast members. Accounts NOT listed here (the admin staff
 * seed+manager/verifier/finance/support, and the fixtures seed+incomplete-bilal
 * and seed+verified-kamran) are deliberately left alone by the reset — they are
 * not part of the named plan/badge cast and have their own reasons to exist.
 */
export const SEED_CAST: CastMember[] = [
  {
    key: 'featured-ali', email: E('featured-ali'), role: 'tutor',
    plan: 'featured', verification: 'verified', completion: 100,
    intent: 'Featured tutor, listed — shows all three badges.',
  },
  {
    key: 'premium-sara', email: E('premium-sara'), role: 'tutor',
    plan: 'premium', verification: 'verified', completion: 100,
    intent: 'Premium tutor, listed — Verified + Premium badges.',
  },
  {
    key: 'verified-usman', email: E('verified-usman'), role: 'tutor',
    plan: 'verified', verification: 'verified', completion: 100,
    intent: 'Verified tutor, listed — Verified badge only.',
  },
  {
    key: 'free-nadia', email: E('free-nadia'), role: 'tutor',
    plan: null, verification: 'verified', completion: 100,
    intent: 'Free tutor at 100%, listed, NO plan — no badge.',
  },
  {
    key: 'free-hina', email: E('free-hina'), role: 'tutor',
    plan: null, verification: 'verified',
    intent: 'Free tutor, NO plan.',
  },
  {
    key: 'suspended-omar', email: E('suspended-omar'), role: 'tutor',
    plan: null, verification: 'suspended', suspended: true,
    intent: 'Suspended tutor — every power off, not listed.',
  },
  {
    key: 'featured-ayesha', email: E('featured-ayesha'), role: 'parent',
    plan: 'parent_featured', parentVerified: true,
    intent: 'Featured parent — can hire, sees contact.',
  },
  {
    key: 'verified-fatima', email: E('verified-fatima'), role: 'parent',
    plan: null, parentVerified: true,
    intent: 'Verified parent (free tier), NO paid plan.',
  },
  {
    key: 'unverified-zain', email: E('unverified-zain'), role: 'parent',
    plan: null, parentVerified: false,
    intent: 'Unverified parent — browse only.',
  },
]

/**
 * The identity-line columns a cast member's `profiles` row should carry, derived
 * from the cast intent — PURE, so the reset can write it and a unit test can
 * assert it agrees with itself.
 *
 * The dashboard identity line reads `cnic_verified_at` and `verification_state`.
 * A seed tutor is made 'verified' straight on `tutor_profiles.verification_status`
 * (the video/moderation path), which never advanced those CNIC columns — so the
 * line read "Not submitted" beside three badges. A verified tutor's identity IS
 * approved, so the columns must say so. For a parent the identity fact is CNIC +
 * address approved (`parentVerified`). Everyone else is 'none'.
 *
 * INVARIANT (what the test pins): `verified` is true exactly when
 * `verificationState === 'approved'`. A row can never claim one without the other.
 */
export type IdentityIntent = { verified: boolean; verificationState: 'approved' | 'none' }

export function expectedIdentity(m: CastMember): IdentityIntent {
  const verified = m.role === 'tutor' ? m.verification === 'verified' : !!m.parentVerified
  return { verified, verificationState: verified ? 'approved' : 'none' }
}

/** The fields the smoke test snapshots and compares. */
export type CastSnapshotRow = {
  email: string
  role: string | null
  completion: number | null
  suspended: boolean
  verification: string | null
  activePlan: string | null
}
