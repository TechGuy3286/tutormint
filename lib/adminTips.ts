import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// The overview's conversion tips (owner, 14 Sep 2026): real, clickable worklists
// of tutors the team can nudge onto a paid plan — never generic advice text.
// Each tip is one query; a zero count is shown, never fabricated. Three of the
// four open a filtered member list (via ?tip=); "Never verified" counts
// pre-account drafts in pending_signups, which are not members, so it points at
// the Abandoned signups page instead.
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
  verified: boolean
  createdAt: string
}

/** user_ids with a currently-active subscription (status active, not expired). */
async function paidUserIds(admin: Admin, nowIso: string): Promise<Set<string>> {
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .gt('expires_at', nowIso)
  return new Set((data ?? []).map((s) => s.user_id as string))
}

/** Every tutor with the facts the tips key on. Small set; one pass. */
async function tutorFacts(admin: Admin): Promise<TutorFacts[]> {
  const { data: profs } = await admin
    .from('profiles')
    .select('id, profile_completion, phone_verified_at, created_at')
    .eq('role', 'tutor')
  const rows = profs ?? []
  const ids = rows.map((p) => p.id as string)
  const none = ['00000000-0000-0000-0000-000000000000']
  const { data: tp } = await admin
    .from('tutor_profiles')
    .select('id, verification_status')
    .in('id', ids.length ? ids : none)
  const verById = new Map((tp ?? []).map((t) => [t.id as string, t.verification_status as string]))
  return rows.map((p) => ({
    id: p.id as string,
    completion: (p.profile_completion as number) ?? 0,
    phoneVerified: !!p.phone_verified_at,
    verified: verById.get(p.id as string) === 'verified',
    createdAt: (p.created_at as string) ?? '',
  }))
}

/** Newest first — a proxy for "most recently active" (no last-active column). */
const byNewest = (a: TutorFacts, b: TutorFacts) => (a.createdAt < b.createdAt ? 1 : -1)

function selectTip(tip: TipKey, tutors: TutorFacts[], paid: Set<string>): TutorFacts[] {
  const unpaid = tutors.filter((t) => !paid.has(t.id))
  if (tip === 'unpaid-tutors') return [...unpaid].sort(byNewest)
  // Closest to converting: a finished, verified profile with no plan.
  if (tip === 'listed-unpaid') return unpaid.filter((t) => t.completion >= 100 && t.verified).sort(byNewest)
  // Signed up, never filled: proven their number but barely started.
  return tutors.filter((t) => t.phoneVerified && t.completion < 25).sort(byNewest)
}

/** The member ids for one tip, newest first. Empty array = nobody matches. */
export async function resolveTipMemberIds(tip: TipKey): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const nowIso = new Date().toISOString()
  const [paid, tutors] = await Promise.all([paidUserIds(admin, nowIso), tutorFacts(admin)])
  return selectTip(tip, tutors, paid).map((t) => t.id)
}

/** All four counts for the overview Tips block. */
export async function loadTipCounts(admin: Admin, nowIso: string): Promise<TipCounts> {
  const [paid, tutors, expiredPending] = await Promise.all([
    paidUserIds(admin, nowIso),
    tutorFacts(admin),
    admin
      .from('pending_signups')
      .select('token', { count: 'exact', head: true })
      .lt('expires_at', nowIso),
  ])
  return {
    unpaidTutors: selectTip('unpaid-tutors', tutors, paid).length,
    listedUnpaid: selectTip('listed-unpaid', tutors, paid).length,
    neverFilled: selectTip('never-filled', tutors, paid).length,
    neverVerified: expiredPending.count ?? 0,
  }
}
