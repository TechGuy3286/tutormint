// lib/quota.ts
//
// Monthly quota accounting, in one place.
//
// Every plan advertises a number ("10", "25", "Unlimited") and every plan has
// a real cap behind it -- "Unlimited" is 100. CLAUDE.md is explicit that the
// admin dashboard must be able to show real usage against that 100, so the
// counter is always incremented, including for "Unlimited" members.
//
// The counter is written with the service-role client. usage_counters is
// self-read/admin-write under RLS, deliberately: if members could increment
// their own counter they could also decrement it, and quota would be
// advisory. A member sees their usage; only the server changes it.
//
// WHY THIS IS TWO CALLS AND NOT ONE
// A single consumeQuota(userId, kind) that both checked and spent would have
// to spend before the work happened -- there is no transaction spanning the
// quota row and the insert it is guarding. So a tutor whose application then
// failed to insert would lose an application from their allowance. The two
// halves are therefore ordered check -> do the work -> consume, and the
// kind-specific knowledge (which counter column, which noun, which packages
// page) lives here so callers never repeat it.
//
// The period key is a UTC calendar month. Quota resets when the month rolls
// over, not 30 days after purchase -- so buying on the 28th genuinely does
// give a smaller first month, which is what "monthly allowance" means and what
// the packages page says.

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod, type Entitlements } from '@/lib/entitlements'
import { upgradeHref } from '@/lib/upgradePath'

/** The counter columns on usage_counters. */
export type QuotaField = 'jobs_applied' | 'jobs_posted' | 'messages_initiated'

/** What a caller is about to do. The only vocabulary callers need to know. */
export type QuotaKind = 'job_application' | 'job_post' | 'message_initiation'

const KINDS: Record<QuotaKind, { field: QuotaField; noun: string; audience: 'tutor' | 'parent' }> = {
  job_application: { field: 'jobs_applied', noun: 'apply for jobs', audience: 'tutor' },
  job_post: { field: 'jobs_posted', noun: 'post a job', audience: 'parent' },
  message_initiation: {
    field: 'messages_initiated',
    noun: 'start conversations',
    audience: 'tutor',
  },
}

export type QuotaCheck =
  | { ok: true }
  // `reason` distinguishes 'no plan at all' from 'plan exhausted'. They read
  // the same to a caller checking `ok`, but they are different sentences and
  // different plan cards in the upgrade sheet: one sells the entry plan, the
  // other sells the tier above whatever they already bought.
  | { ok: false; status: number; error: string; upgrade?: string; reason: 'no_plan' | 'exhausted' }

/**
 * Is there room to do this thing? Reads the entitlements that were already
 * loaded, so this costs nothing extra.
 */
export function checkQuota(ent: Entitlements, kind: QuotaKind): QuotaCheck {
  const spec = KINDS[kind]
  const audience = ent.audience ?? spec.audience
  const href = upgradeHref(audience, ent.plan)

  if (!ent.plan) {
    return {
      ok: false,
      status: 403,
      error: `You need an active plan to ${spec.noun}.`,
      upgrade: href,
      reason: 'no_plan',
    }
  }
  if (ent.quotaLeft <= 0) {
    return {
      ok: false,
      status: 403,
      // The member is told their real remaining allowance, not the marketing
      // word: someone who has hit the cap needs to know they have hit it.
      error: `You have used all ${ent.quota} of this month's allowance.`,
      upgrade: href,
      reason: 'exhausted',
    }
  }
  return { ok: true }
}

/**
 * Record one unit of usage for the current period. Called AFTER the work
 * succeeded, never before.
 *
 * Upserts on (user_id, period) and increments, so the first action of a month
 * creates the row and the rest add to it.
 */
export async function consumeQuota(userId: string, kind: QuotaKind): Promise<void> {
  const field = KINDS[kind].field
  const admin = createAdminClient()
  if (!admin) {
    console.error('[quota] service-role client unavailable; usage NOT recorded', field)
    return
  }

  const period = currentPeriod()

  const { data: existing } = await admin
    .from('usage_counters')
    .select('user_id, jobs_applied, jobs_posted, messages_initiated')
    .eq('user_id', userId)
    .eq('period', period)
    .maybeSingle()

  if (!existing) {
    const { error } = await admin.from('usage_counters').insert({
      user_id: userId,
      period,
      jobs_applied: field === 'jobs_applied' ? 1 : 0,
      jobs_posted: field === 'jobs_posted' ? 1 : 0,
      messages_initiated: field === 'messages_initiated' ? 1 : 0,
    })
    if (error) console.error('[quota] insert failed', error.message)
    return
  }

  const { error } = await admin
    .from('usage_counters')
    .update({
      [field]: ((existing[field] as number) ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('period', period)

  if (error) console.error('[quota] increment failed', error.message)
}
