import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// The overview's conversion tips (owner, 14 Sep 2026; reworked PR32 §4 for the
// verification funnel): real, clickable worklists of tutors the team can nudge to
// GET VERIFIED — pay the one-time Rs 199 fee — never generic advice text. "Paid"
// means the fee, not a subscription; the fee no longer gates Browse visibility
// (migration 94), so "listed but unpaid" is a real set — a tutor already shown in
// Browse who has not yet paid, the closest to converting. Each tip is one query;
// a zero count is shown, never fabricated. Three of the four open a filtered
// member list (via ?tip=); "Never verified" counts pre-account drafts in
// pending_signups, which are not members, so it points at the Abandoned signups
// page instead.
//
// The platform is tiny (tens of tutors), so resolving the full id set per tip is
// cheap and paging within it is fine. resolveTipMemberIds() is shared by the
// members page and its load-more route so a tip window never restores another's.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** The three member-list tips. "never-verified" is not here — it is not a member. */
export type TipKey = 'unpaid-tutors' | 'listed-unpaid' | 'never-filled'

export const TIP_KEYS: TipKey[] = ['unpaid-tutors', 'listed-unpaid', 'never-filled']

export function isTipKey(v: string): v is TipKey {
  return (TIP_KEYS as string[]).includes(v)
}

export type TipCounts = {
  unpaidTutors: number
  listedUnpaid: number
  neverFilled: number
  neverVerified: number
}

type TutorFacts = {
  id: string
  completion: number
  phoneVerified: boolean
  /** The one-time Rs 199 verification fee is paid (tutor_profiles.verified_fee_paid_at). */
  feePaid: boolean
  /** In tutor_directory — visible in Browse (the migration-94 visibility rule). */
  listed: boolean
  createdAt: string
}

/**
 * Every tutor with the facts the tips key on (owner PR32 §4). "Paid" here means
 * the ONE-TIME VERIFICATION FEE — the get-verified funnel — not a subscription:
 * the tips nudge tutors to get verified, so the fee is the fact that matters.
 * `listed` is membership of tutor_directory (fee no longer gates visibility since
 * migration 94), so "listed but unpaid" is a real, coherent set.
 */
async function tutorFacts(admin: Admin): Promise<TutorFacts[]> {
  const { data: profs } = await admin
    .from('profiles')
    .select('id, profile_completion, phone_verified_at, created_at')
    .eq('role', 'tutor')
  const rows = profs ?? []
  const ids = rows.map((p) => p.id as string)
  const none = ['00000000-0000-0000-0000-000000000000']
  const [{ data: tp }, { data: listedRows }] = await Promise.all([
    admin.from('tutor_profiles').select('id, verified_fee_paid_at').in('id', ids.length ? ids : none),
    admin.from('tutor_directory').select('id').in('id', ids.length ? ids : none),
  ])
  const feeById = new Map((tp ?? []).map((t) => [t.id as string, !!t.verified_fee_paid_at]))
  const listed = new Set((listedRows ?? []).map((r) => r.id as string))
  return rows.map((p) => ({
    id: p.id as string,
    completion: (p.profile_completion as number) ?? 0,
    phoneVerified: !!p.phone_verified_at,
    feePaid: feeById.get(p.id as string) ?? false,
    listed: listed.has(p.id as string),
    createdAt: (p.created_at as string) ?? '',
  }))
}

/** Newest first — a proxy for "most recently active" (no last-active column). */
const byNewest = (a: TutorFacts, b: TutorFacts) => (a.createdAt < b.createdAt ? 1 : -1)

function selectTip(tip: TipKey, tutors: TutorFacts[]): TutorFacts[] {
  // Not yet verified — the fee is unpaid. Newest first.
  if (tip === 'unpaid-tutors') return tutors.filter((t) => !t.feePaid).sort(byNewest)
  // Closest to converting: already shown in Browse (listed), only the fee is
  // missing. Fee no longer gates visibility (migration 94), so this set exists.
  if (tip === 'listed-unpaid') return tutors.filter((t) => t.listed && !t.feePaid).sort(byNewest)
  // Signed up, never filled: proven their number but barely started.
  return tutors.filter((t) => t.phoneVerified && t.completion < 25).sort(byNewest)
}

/** The member ids for one tip, newest first. Empty array = nobody matches. */
export async function resolveTipMemberIds(tip: TipKey): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const tutors = await tutorFacts(admin)
  return selectTip(tip, tutors).map((t) => t.id)
}

/** All four counts for the overview Tips block. */
export async function loadTipCounts(admin: Admin, nowIso: string): Promise<TipCounts> {
  const [tutors, expiredPending] = await Promise.all([
    tutorFacts(admin),
    admin
      .from('pending_signups')
      .select('token', { count: 'exact', head: true })
      .lt('expires_at', nowIso),
  ])
  return {
    unpaidTutors: selectTip('unpaid-tutors', tutors).length,
    listedUnpaid: selectTip('listed-unpaid', tutors).length,
    neverFilled: selectTip('never-filled', tutors).length,
    neverVerified: expiredPending.count ?? 0,
  }
}
