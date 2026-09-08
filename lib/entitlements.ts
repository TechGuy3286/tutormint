// lib/entitlements.ts
//
// What a member is allowed to do, decided in one place, on the server.
//
// CLAUDE.md rule 6: "Entitlements are enforced server-side (RLS +
// lib/entitlements.ts), never only by hiding a button." Every gated surface --
// contact reveal, WhatsApp link, message initiation, hire, quotas -- asks this
// module and acts on the answer. Hiding a button is the cosmetic half; the
// route that would have been called must refuse too.
//
// Plan powers come from the `plans` table, not from constants here, so the
// owner can change a plan's abilities in SQL without a deploy and without the
// code and the database disagreeing about what was sold.
//
// Two things this module owns that are easy to get wrong:
//
//   * Expiry. A subscription is only active while status='active' AND
//     expires_at is in the future. There is no grace period (owner decision),
//     so an expired plan gives nothing from the moment it lapses.
//
//   * The free-verified parent. parent_verified costs nothing, so a verified
//     parent has no subscription row at all. Reading only `subscriptions`
//     would leave them with no powers, unable to message or post. Their plan
//     is therefore synthesised from CNIC + address approval.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { badgesForPlan, isFeaturedPlan, tutorListed, type BadgeName } from '@/lib/planBadges'

// The pure plan -> badge mapping lives in lib/planBadges.ts so client
// components can import it without pulling next/headers into the browser
// bundle. Re-exported here so server callers still have one import.
export { badgesForPlan, isFeaturedPlan }
export type { BadgeName }

export type PlanCode =
  | 'verified'
  | 'premium'
  | 'featured'
  | 'parent_verified'
  | 'parent_featured'

export type Entitlements = {
  userId: string
  role: string | null
  audience: 'tutor' | 'parent' | null
  /** null = no plan at all (a free, unverified or lapsed account). */
  plan: PlanCode | null
  planName: string | null
  expiresAt: string | null
  /** The real cap. 100 even when the plan advertises "Unlimited". */
  quota: number
  quotaUsed: number
  quotaLeft: number
  /** What the member is shown: "10", "25", "Unlimited". */
  displayedQuota: string | null
  canViewContact: boolean
  canWhatsapp: boolean
  canInitiateMessage: boolean
  canHire: boolean
  /**
   * Tutor-side: may see WHO viewed their profile, not just that someone did.
   * Deliberately separate from canViewContact -- Verified (199) and above reveal
   * the viewer's name (migration 57); Featured additionally reveals contact
   * details on the profile.
   */
  canSeeViewerIdentity: boolean
  searchRank: number
  badges: BadgeName[]
  tagLabel: string | null
  /** Badges are withheld below 100% however much was paid. */
  profileComplete: boolean
  /** The raw percentage, for a gate that says "your profile is 93% complete". */
  profileCompletion: number
  /**
   * Tutor is LISTED — 100% complete, not suspended, verification not
   * rejected/suspended, and claimed if imported. This, not profileComplete, is
   * what a badge clears: a paid plan alone never draws one. Always true-ish for
   * parents (they are not listed anywhere; kept `false` and unused for them).
   */
  listed: boolean
  /**
   * The member has PAID for a plan whose 30 days have not started, because a
   * tutor bought while under 100%. It grants no powers and no badge yet; the
   * clock and the badge both begin on the day they go live. `plan` stays null
   * while paused -- gated routes must not treat a paused plan as active -- but
   * the dashboard shows "<plan> plan active · your badge appears at 100%".
   */
  planPaused: boolean
  pausedPlanName: string | null
  /**
   * Suspended by a moderator. Every power is off regardless of what was paid,
   * and no subscription is cancelled -- the plan keeps running, so reinstating
   * restores exactly what they had.
   */
  suspended: boolean
  /** Permanently banned (fraud). Every power is off; login is walled elsewhere. */
  banned: boolean
  /** How the number was proved: 'otp' | 'bridge' | null. */
  phoneVerifiedVia: string | null
  /**
   * The number was proved only by the BRIDGE_OTP stopgap, never by a real code
   * (owner, Part 5). A shared bridge code proves nothing, and mobile
   * verification is one pillar of "Trust = verification" — so a bridge-verified
   * account holds NO plan and NO badge until it re-verifies with a real code.
   * Every power is off, exactly like a lapsed plan; the account is otherwise
   * usable (it is not suspended), and the dashboard explains the lock.
   */
  bridgeLocked: boolean
}

const NOTHING = (userId: string): Entitlements => ({
  userId,
  role: null,
  audience: null,
  plan: null,
  planName: null,
  expiresAt: null,
  quota: 0,
  quotaUsed: 0,
  quotaLeft: 0,
  displayedQuota: null,
  canViewContact: false,
  canWhatsapp: false,
  canInitiateMessage: false,
  canHire: false,
  canSeeViewerIdentity: false,
  searchRank: 0,
  badges: [],
  tagLabel: null,
  profileComplete: false,
  profileCompletion: 0,
  listed: false,
  planPaused: false,
  pausedPlanName: null,
  suspended: false,
  banned: false,
  phoneVerifiedVia: null,
  bridgeLocked: false,
})

/** YYYY-MM — the period usage_counters is keyed by. */
export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type PlanRow = {
  code: string
  audience: string
  name: string
  monthly_quota: number | null
  displayed_quota: string | null
  can_view_contact: boolean
  can_whatsapp: boolean
  can_initiate_message: boolean
  can_hire: boolean
  can_see_viewer_identity: boolean
  search_rank: number | null
  badges: string[] | null
  tag_label: string | null
}

/**
 * The one call every gated surface makes.
 *
 * Reads through the service-role client where available: entitlements are
 * consulted for the viewer on pages that also render for anonymous visitors,
 * and `subscriptions` is self-read-only under RLS. Falls back to the session
 * client, which returns the right answer for the signed-in member reading
 * their own entitlements -- so a missing service key degrades to "your own
 * plan still works" rather than to "nobody has a plan".
 */
/** The already-fetched facts computeEntitlements decides from. */
export type EntitlementInputs = {
  userId: string
  profile: {
    role: string | null
    profile_completion: number | null
    cnic_verified_at: string | null
    address_verified_at: string | null
    is_suspended: boolean | null
    is_banned: boolean | null
    phone_verified_via: string | null
  } | null
  tutorRow: { verification_status: string | null; imported: boolean | null; claimed_at: string | null } | null
  /** Active AND unexpired subscription rows — the caller filters status/expiry. */
  activeSubs: { plan_code: string; expires_at: string | null }[]
  /** The most-recent paused subscription's plan code, or null. */
  pausedPlanCode: string | null
  plans: PlanRow[]
  counter: { jobs_applied: number | null; jobs_posted: number | null } | null
}

/**
 * The whole entitlement decision, as a PURE function (owner, Part 5 — so it is
 * unit-testable without the one shared database). getEntitlements() below does
 * the I/O and hands the fetched rows here; the ordering of the short-circuits —
 * banned, then suspended, then the bridge lock, then plan resolution — is the
 * contract, and each is exercised by scripts/test-auth-trust.ts.
 */
export function computeEntitlements(input: EntitlementInputs): Entitlements {
  const { userId, profile, tutorRow } = input
  if (!profile) return NOTHING(userId)

  const role = (profile.role as string | null) ?? null
  const audience: 'tutor' | 'parent' | null =
    role === 'tutor' ? 'tutor' : role === 'parent' || role === 'academy' ? 'parent' : null

  const profileCompletion = profile.profile_completion ?? 0
  const profileComplete = profileCompletion >= 100

  // `listed` is what a tutor's badge clears — the tutor_directory rule in TS.
  const listed =
    role === 'tutor'
      ? tutorListed({
          profileComplete,
          verificationStatus: tutorRow?.verification_status,
          isSuspended: profile.is_suspended,
          imported: tutorRow?.imported,
          claimedAt: tutorRow?.claimed_at,
        })
      : false

  // BAN short-circuits everything. The login route already refuses a banned
  // account with no session; this is the backstop for a session that was live
  // when the ban landed. Reported as suspended too, so every "if suspended"
  // check downstream also closes for a banned account.
  if (profile.is_banned) {
    return { ...NOTHING(userId), role, audience, profileComplete, profileCompletion, suspended: true, banned: true }
  }

  // SUSPENSION short-circuits the rest. EITHER FLAG COUNTS: profiles.is_suspended
  // is the fact, but tutor_profiles.verification_status='suspended' was once
  // reachable on its own and rows still carry it — reading only the profile flag
  // left such a tutor told to 'complete your profile' at 100%.
  const suspendedByProfile = !!profile.is_suspended
  const suspendedByListing = tutorRow?.verification_status === 'suspended'
  if (suspendedByProfile || suspendedByListing) {
    return { ...NOTHING(userId), role, audience, profileComplete, profileCompletion, suspended: true }
  }

  // The BRIDGE lock (owner, Part 5). A number proved only by the BRIDGE_OTP
  // stopgap holds no plan and no badge until re-verified with a real code —
  // decided BEFORE plans are considered, so it holds even if a plan row is
  // active. `listed` is kept (the lock removes plan/badge, not the listing).
  const phoneVerifiedVia = (profile.phone_verified_via as string | null) ?? null
  if (phoneVerifiedVia === 'bridge') {
    return { ...NOTHING(userId), role, audience, profileComplete, profileCompletion, listed, phoneVerifiedVia, bridgeLocked: true }
  }

  const plans = new Map<string, PlanRow>()
  for (const p of input.plans) plans.set(p.code, p)

  // Highest-ranked active subscription wins, so an admin grant layered over an
  // older plan does not downgrade anyone.
  let best: { plan: PlanRow; expiresAt: string | null } | null = null
  for (const s of input.activeSubs) {
    const p = plans.get(s.plan_code)
    if (!p || p.audience !== audience) continue
    if (!best || (p.search_rank ?? 0) > (best.plan.search_rank ?? 0)) {
      best = { plan: p, expiresAt: s.expires_at ?? null }
    }
  }

  // The free tier a verified parent gets without paying anything.
  if (!best && audience === 'parent' && profile.cnic_verified_at && profile.address_verified_at) {
    const free = plans.get('parent_verified')
    if (free) best = { plan: free, expiresAt: null }
  }

  // A PAUSED plan: paid for, but the clock has not started. It confers nothing;
  // surfaced only so the dashboard can say the plan is waiting.
  let planPaused = false
  let pausedPlanName: string | null = null
  if (!best && input.pausedPlanCode) {
    planPaused = true
    pausedPlanName = plans.get(input.pausedPlanCode)?.name ?? null
  }

  if (!best) {
    return { ...NOTHING(userId), role, audience, profileComplete, profileCompletion, listed, planPaused, pausedPlanName, phoneVerifiedVia }
  }

  const p = best.plan
  const quota = p.monthly_quota ?? 0
  const quotaUsed =
    audience === 'tutor' ? (input.counter?.jobs_applied ?? 0) : (input.counter?.jobs_posted ?? 0)

  return {
    userId,
    role,
    audience,
    plan: p.code as PlanCode,
    planName: p.name,
    expiresAt: best.expiresAt,
    quota,
    quotaUsed,
    quotaLeft: Math.max(0, quota - quotaUsed),
    displayedQuota: p.displayed_quota,
    canViewContact: !!p.can_view_contact,
    canWhatsapp: !!p.can_whatsapp,
    canInitiateMessage: !!p.can_initiate_message,
    canHire: !!p.can_hire,
    canSeeViewerIdentity: !!p.can_see_viewer_identity,
    searchRank: p.search_rank ?? 0,
    // A tutor's badge clears `listed`; a parent has no listing, so completion is
    // their gate.
    badges: badgesForPlan(p.code, audience === 'tutor' ? listed : profileComplete),
    tagLabel: (audience === 'tutor' ? listed : profileComplete) ? p.tag_label : null,
    profileComplete,
    profileCompletion,
    listed,
    planPaused: false,
    pausedPlanName: null,
    suspended: false,
    banned: false,
    phoneVerifiedVia,
    bridgeLocked: false,
  }
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
  if (!userId) return NOTHING(userId)

  const db = createAdminClient() ?? (await createClient())

  const { data: profile } = await db
    .from('profiles')
    .select('id, role, profile_completion, cnic_verified_at, address_verified_at, is_suspended, is_banned, phone_verified_via')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return NOTHING(userId)

  const role = (profile.role as string | null) ?? null

  // Fetch the rest in parallel, then let the pure function decide. The locked
  // paths (banned/suspended/bridge) do not read subs, but fetching them anyway
  // is a couple of small reads on rare accounts and keeps the decision pure.
  const [tutorRes, subsRes, planRes, pausedRes, counterRes] = await Promise.all([
    role === 'tutor'
      ? db.from('tutor_profiles').select('verification_status, imported, claimed_at').eq('id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('subscriptions')
      .select('plan_code, expires_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
    db
      .from('plans')
      .select(
        'code, audience, name, monthly_quota, displayed_quota, can_view_contact, can_whatsapp, can_initiate_message, can_hire, can_see_viewer_identity, search_rank, badges, tag_label',
      ),
    db
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', userId)
      .eq('status', 'paused')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('usage_counters')
      .select('jobs_applied, jobs_posted, messages_initiated')
      .eq('user_id', userId)
      .eq('period', currentPeriod())
      .maybeSingle(),
  ])

  return computeEntitlements({
    userId,
    profile: {
      role,
      profile_completion: (profile.profile_completion as number | null) ?? null,
      cnic_verified_at: (profile.cnic_verified_at as string | null) ?? null,
      address_verified_at: (profile.address_verified_at as string | null) ?? null,
      is_suspended: (profile.is_suspended as boolean | null) ?? null,
      is_banned: (profile.is_banned as boolean | null) ?? null,
      phone_verified_via: (profile.phone_verified_via as string | null) ?? null,
    },
    tutorRow: (tutorRes.data as EntitlementInputs['tutorRow']) ?? null,
    activeSubs: ((subsRes.data ?? []) as { plan_code: string; expires_at: string | null }[]).map((s) => ({
      plan_code: s.plan_code,
      expires_at: s.expires_at ?? null,
    })),
    pausedPlanCode: (pausedRes.data?.plan_code as string | null) ?? null,
    plans: (planRes.data ?? []) as PlanRow[],
    counter: (counterRes.data as EntitlementInputs['counter']) ?? null,
  })
}

/**
 * Entitlements for whoever is signed in, or null when nobody is.
 * The common shape for a public page that must behave differently for a
 * guest, a free member and a paying one.
 */
export async function getViewerEntitlements(): Promise<Entitlements | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return getEntitlements(user.id)
}
