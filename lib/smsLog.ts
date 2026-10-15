import 'server-only'

// lib/smsLog.ts — every SMS send goes through sendSms(), which hands the message
// to the ONE adapter getSmsProvider() selects (SendPK on the live site) and
// writes a row to sms_sends (owner, 15 Oct 2026). The row holds the time, the
// purpose, the number MASKED, the outcome and SendPK's message id or error
// text — never a full number, a code or the message body (lib/smsHealthCore
// builds the row). Recording is best-effort: a failed insert never changes what
// the member is told, and is logged.
//
// Also here: the admin SMS screen's figures, the hourly health check that
// emails the Owner, and the 90-day clean-up.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSmsProvider, smsProviderLabel, type SmsResult } from '@/lib/sms'
import { SENDPK_ENV_KEYS, sendpkBalance } from '@/lib/sms/sendpk'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import {
  failureWindowStart,
  QUIET_WINDOW_MS,
  SMS_RETENTION_DAYS,
  smsAlertDecision,
  smsAlertMessage,
  smsLogRow,
  type SmsOutcome,
  type SmsPurpose,
} from '@/lib/smsHealthCore'

/** Write one row. Never throws. */
export async function recordSms(o: {
  purpose: SmsPurpose
  phone: string
  outcome: SmsOutcome
  provider?: string | null
  messageId?: string | null
  error?: string | null
  actorId?: string | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { error } = await admin.from('sms_sends').insert(smsLogRow(o))
    if (error) console.warn('[sms-log] not recorded:', error.message)
  } catch (e) {
    console.warn('[sms-log] not recorded:', e instanceof Error ? e.message : 'error')
  }
}

/** Send one SMS through the selected adapter and record the attempt. */
export async function sendSms(o: { to: string; body: string; purpose: SmsPurpose; actorId?: string | null }): Promise<SmsResult> {
  const provider = getSmsProvider()
  let result: SmsResult
  try {
    result = await provider.send(o.to, o.body)
  } catch (e) {
    result = { ok: false, provider: provider.name, error: e instanceof Error ? e.message : 'send threw' }
  }
  await recordSms({
    purpose: o.purpose,
    phone: o.to,
    outcome: result.ok ? 'sent' : 'failed',
    provider: result.provider,
    messageId: result.ok ? result.id ?? null : null,
    error: result.ok ? null : result.error,
    actorId: o.actorId ?? null,
  })
  return result
}

export type SmsLogEntry = {
  id: string
  createdAt: string
  purpose: SmsPurpose
  toMasked: string
  provider: string | null
  outcome: SmsOutcome
  messageId: string | null
  error: string | null
}

export type SmsHealth = {
  provider: string
  settings: { name: string; present: boolean }[]
  lastSuccessAt: string | null
  sent24h: number
  sent7d: number
  failed24h: number
  lastError: { at: string; text: string } | null
  balance: { ok: true; pkr: number } | { ok: false; error: string }
  recent: SmsLogEntry[]
  alerts: { id: string; createdAt: string; message: string; reasons: string[] }[]
}

function toEntry(r: Record<string, unknown>): SmsLogEntry {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    purpose: r.purpose as SmsPurpose,
    toMasked: r.to_masked as string,
    provider: (r.provider as string | null) ?? null,
    outcome: r.outcome as SmsOutcome,
    messageId: (r.message_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  }
}

async function countSince(outcome: SmsOutcome, sinceMs: number): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin
    .from('sms_sends')
    .select('id', { count: 'exact', head: true })
    .eq('outcome', outcome)
    .gte('created_at', new Date(sinceMs).toISOString())
  return count ?? 0
}

async function lastOf(outcome: SmsOutcome): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('sms_sends')
    .select('created_at, error')
    .eq('outcome', outcome)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

/** Everything Admin → Settings → SMS shows. */
export async function loadSmsHealth(now = Date.now()): Promise<SmsHealth> {
  const admin = createAdminClient()
  const day = now - 24 * 60 * 60 * 1000
  const week = now - 7 * 24 * 60 * 60 * 1000
  const [lastOk, lastFail, sent24h, sent7d, failed24h, balance, recentRes, alertsRes] = await Promise.all([
    lastOf('sent'),
    lastOf('failed'),
    countSince('sent', day),
    countSince('sent', week),
    countSince('failed', day),
    sendpkBalance(),
    admin
      ? admin.from('sms_sends').select('id, created_at, purpose, to_masked, provider, outcome, message_id, error').order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    admin ? admin.from('sms_alerts').select('id, created_at, message, reasons').order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ])
  return {
    provider: smsProviderLabel(),
    settings: SENDPK_ENV_KEYS.map((name) => ({ name, present: !!process.env[name]?.trim() })),
    lastSuccessAt: (lastOk?.created_at as string | undefined) ?? null,
    sent24h,
    sent7d,
    failed24h,
    lastError:
      lastFail && new Date(lastFail.created_at as string).getTime() >= day
        ? { at: lastFail.created_at as string, text: (lastFail.error as string | null) ?? 'failed' }
        : null,
    balance,
    recent: ((recentRes.data ?? []) as Record<string, unknown>[]).map(toEntry),
    alerts: ((alertsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      message: r.message as string,
      reasons: (r.reasons as string[] | null) ?? [],
    })),
  }
}

/**
 * The hourly check (owner, 15 Oct 2026). Emails the Owner(s) and adds a bell
 * notification when a send failed, or when 2+ numbers asked for a signup/verify
 * code in the last 12 hours and no SMS was sent — at most once per 6 hours.
 */
export async function runSmsHealthCheck(now = Date.now()): Promise<{ fired: boolean; reasons: string[]; heldByCooldown: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { fired: false, reasons: [], heldByCooldown: false }

  const { data: lastAlert } = await admin.from('sms_alerts').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const lastAlertAt = lastAlert ? new Date(lastAlert.created_at as string).getTime() : null
  const quietStart = new Date(now - QUIET_WINDOW_MS).toISOString()

  const [{ data: failures }, { count: successes }, { data: requests }, lastOk] = await Promise.all([
    admin
      .from('sms_sends')
      .select('purpose')
      .eq('outcome', 'failed')
      .neq('purpose', 'test')
      .gt('created_at', new Date(failureWindowStart(now, lastAlertAt)).toISOString())
      .limit(1000),
    admin.from('sms_sends').select('id', { count: 'exact', head: true }).eq('outcome', 'sent').gte('created_at', quietStart),
    admin.from('sms_sends').select('to_masked').in('purpose', ['signup', 'verify']).gte('created_at', quietStart).limit(1000),
    lastOf('sent'),
  ])

  const decision = smsAlertDecision({
    now,
    lastAlertAt,
    newFailures: (failures ?? []).length,
    failedPurposes: ((failures ?? []) as { purpose: string }[]).map((r) => r.purpose),
    codeRequests12h: new Set(((requests ?? []) as { to_masked: string }[]).map((r) => r.to_masked)).size,
    successes12h: successes ?? 0,
  })
  if (!decision.fire) return { fired: false, reasons: decision.reasons, heldByCooldown: decision.heldByCooldown }

  const lastSuccessAt = (lastOk?.created_at as string | undefined) ?? null
  const message = smsAlertMessage(lastSuccessAt)
  // Record first: if the insert fails, do not email (the next run tries again).
  const { error } = await admin.from('sms_alerts').insert({ reasons: decision.reasons, last_success_at: lastSuccessAt, message })
  if (error) {
    console.error('[sms-health] alert not recorded:', error.message)
    return { fired: false, reasons: decision.reasons, heldByCooldown: false }
  }

  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner')
  for (const o of owners ?? []) {
    const ownerId = o.id as string
    await notify({ userId: ownerId, kind: 'sms_alert', title: 'SMS may not be sending', body: message, href: '/admin/settings/sms' })
    await deliverEmail({ userId: ownerId }, { id: 'sms_alert', message, reasons: decision.reasons }).catch(() => {})
  }
  console.warn('[sms-health] alert sent:', decision.reasons.join(' '))
  return { fired: true, reasons: decision.reasons, heldByCooldown: false }
}

/** Delete SMS log rows older than 90 days (daily cron). Alerts are kept. */
export async function purgeOldSmsSends(now = Date.now()): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { data } = await admin
    .from('sms_sends')
    .delete()
    .lt('created_at', new Date(now - SMS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString())
    .select('id')
  return (data ?? []).length
}
