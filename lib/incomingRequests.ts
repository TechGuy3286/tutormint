// lib/incomingRequests.ts
//
// The Basic incoming hiring & demo request limit (PR54 Part B).
//
// A tutor "receives" a request when a parent asks them for a demo
// (/api/demo/request) or hires them (/api/parent/hire). In-app messages are NOT
// counted. Basic and no-plan tutors receive 10 a month; Premium and Featured
// are unlimited. Counted in usage_counters.incoming_requests, in the same UTC
// period and the same service-role-write / member-read way as applications.
//
// FAIL OPEN. Every read and write here is wrapped so that a missing column
// (the window between deploying this code and applying the migration) or any
// database error lets the request THROUGH — a parent must never be blocked from
// reaching a tutor because a counter is not ready. The count is only ever used
// to REFUSE, so failing to read it can only under-enforce, never over-enforce.

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod, getEntitlements } from '@/lib/entitlements'
import { notify } from '@/lib/notifications'

/** Basic and no-plan tutors: 10 incoming hiring/demo requests a month. Premium:
 *  120 (owner PR63 §A). Featured: unlimited. */
export const INCOMING_CAP = 10
export const PREMIUM_INCOMING_CAP = 120

/** The monthly incoming cap for a plan, or null for unlimited (Featured). */
function incomingCapFor(plan: string | null | undefined): number | null {
  if (plan === 'featured') return null
  if (plan === 'premium') return PREMIUM_INCOMING_CAP
  return INCOMING_CAP
}

/**
 * This period's incoming-request count for a tutor, or null when it cannot be
 * read (column missing, no service client, any error) — the caller then lets
 * the request through.
 */
export async function incomingCount(tutorId: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  try {
    const { data, error } = await admin
      .from('usage_counters')
      .select('incoming_requests')
      .eq('user_id', tutorId)
      .eq('period', currentPeriod())
      .maybeSingle()
    if (error) return null // 42703 (column missing) or any other → fail open
    return (data?.incoming_requests as number | null) ?? 0
  } catch {
    return null
  }
}

/**
 * True when this tutor cannot receive another hiring/demo request this period.
 * Basic/no-plan: 10; Premium: 120; Featured: unlimited. Fails OPEN: an unreadable
 * counter returns false (not capped).
 */
export async function tutorAtIncomingCap(tutorId: string): Promise<boolean> {
  const ent = await getEntitlements(tutorId)
  const cap = incomingCapFor(ent.plan)
  if (cap === null) return false // Featured — unlimited
  const count = await incomingCount(tutorId)
  if (count === null) return false
  return count >= cap
}

/**
 * Record one incoming request against the tutor for this period. Fail-open: a
 * missing column or any error simply records nothing (the request still went
 * through). Read-then-insert-or-increment, mirroring consumeQuota.
 */
export async function recordIncoming(tutorId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const period = currentPeriod()
  try {
    const { data: existing, error: readErr } = await admin
      .from('usage_counters')
      .select('user_id, incoming_requests')
      .eq('user_id', tutorId)
      .eq('period', period)
      .maybeSingle()
    if (readErr) return // column missing → skip silently
    if (!existing) {
      // The other counter columns default to 0, so naming only this one is safe.
      await admin.from('usage_counters').insert({ user_id: tutorId, period, incoming_requests: 1 })
      return
    }
    await admin
      .from('usage_counters')
      .update({
        incoming_requests: ((existing.incoming_requests as number) ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', tutorId)
      .eq('period', period)
  } catch {
    /* fail open — a counter that could not be written is not worth an error */
  }
}

/**
 * Where to send a parent whose request was refused: similar tutors, same
 * subject and city, on the public tutors board. Best-effort — falls back to the
 * whole board if the tutor's subject/city cannot be read.
 */
export async function similarTutorsHref(tutorId: string): Promise<string> {
  const admin = createAdminClient()
  if (!admin) return '/browse/tutors'
  try {
    const [{ data: tp }, { data: subj }] = await Promise.all([
      admin.from('tutor_profiles').select('city').eq('id', tutorId).maybeSingle(),
      admin.from('tutor_subjects').select('master_id').eq('tutor_id', tutorId).limit(1).maybeSingle(),
    ])
    const params = new URLSearchParams()
    if (subj?.master_id) params.set('subject', String(subj.master_id))
    if (tp?.city) params.set('city', tp.city as string)
    const qs = params.toString()
    return qs ? `/browse/tutors?${qs}` : '/browse/tutors'
  } catch {
    return '/browse/tutors'
  }
}

/**
 * The refusal: notify the tutor (no parent name or details) with a link to
 * upgrade, and return the plain parent message plus a similar-tutors link. The
 * caller does NOT create the request.
 */
export async function refuseIncomingRequest(
  tutorId: string,
): Promise<{ error: string; similarHref: string }> {
  // A Premium tutor at 120 is offered Featured (unlimited); a Basic/no-plan tutor
  // at 10 is offered Premium (owner PR63 §A / the next-package rule).
  const ent = await getEntitlements(tutorId)
  const premium = ent.plan === 'premium'
  await notify({
    userId: tutorId,
    kind: 'incoming_request_capped',
    title: 'A parent tried to send you a request',
    body: premium
      ? 'You have reached this month’s limit of 120 hiring and demo requests. Upgrade to Featured to receive unlimited.'
      : 'You have reached this month’s free limit of hiring and demo requests. Upgrade to Premium to receive more.',
    href: premium
      ? '/membership-plans?for=tutors&plan=featured'
      : '/membership-plans?for=tutors&plan=premium',
  })
  return {
    error: "This tutor can't take more requests right now.",
    similarHref: await similarTutorsHref(tutorId),
  }
}
