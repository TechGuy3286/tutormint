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
// Spending happens AFTER the work succeeds, never before. A tutor whose
// application insert fails must not lose an application from their allowance.

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod, type Entitlements } from '@/lib/entitlements'

export type QuotaField = 'jobs_applied' | 'jobs_posted' | 'messages_initiated'

export type QuotaCheck =
  | { ok: true }
  | { ok: false; status: number; error: string; upgrade?: string }

/**
 * Is there room to do this thing? Reads the entitlements that were already
 * loaded, so this costs nothing extra.
 */
export function checkQuota(ent: Entitlements, noun: string, upgradeHref?: string): QuotaCheck {
  if (!ent.plan) {
    return {
      ok: false,
      status: 403,
      error: `You need an active plan to ${noun}.`,
      upgrade: upgradeHref,
    }
  }
  if (ent.quotaLeft <= 0) {
    return {
      ok: false,
      status: 403,
      // The member is told their real remaining allowance, not the marketing
      // word: someone who has hit the cap needs to know they have hit it.
      error: `You have used all ${ent.quota} of this month's allowance.`,
      upgrade: upgradeHref,
    }
  }
  return { ok: true }
}

/**
 * Record one unit of usage for the current period.
 *
 * Upserts on (user_id, period) and increments, so the first action of a month
 * creates the row and the rest add to it. Never called for an action that did
 * not actually happen.
 */
export async function spendQuota(userId: string, field: QuotaField): Promise<void> {
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
    .update({ [field]: ((existing[field] as number) ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('period', period)

  if (error) console.error('[quota] increment failed', error.message)
}
