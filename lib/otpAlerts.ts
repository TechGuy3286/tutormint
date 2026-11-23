import 'server-only'

// lib/otpAlerts.ts — the I/O of lib/otpAlertsCore (owner, 23 Nov 2026 — PR-18
// Part C). Service role.
//
//   queueOtpAlert(memberId)   — after a member's FIRST mobile verification
//                               (both verify paths); one otp_alerts row per
//                               member, ever. Immediate mode sends right after
//                               the response (next/server after()).
//   runOtpAlerts()            — the 1-minute admin cron: sends anything still
//                               pending (the safety net) or, in digest mode,
//                               one digest every 15 minutes.
//   loadOtpAlertSettings() / saveOtpAlertSettings() — the Owner's setting.
//
// The daily budget: alerts stop once the day's sent emails + this alert would
// pass 80 (of the 100 a day), the rows are marked held_limit, and the Owner's
// bell rings once that day. Never a phone, email, CNIC or rupees in an alert,
// a log line or an audit row.

import { after } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendOne } from '@/lib/email/send'
import { DAILY_LIMIT_KEY, parseDailyLimit, isPlaceholder } from '@/lib/email/policyCore'
import { notify } from '@/lib/notifications'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import { pageAllIn } from '@/lib/pageAll'
import type { AdminActor } from '@/lib/adminAuth'
import { flowFactsByTutor } from '@/lib/onboardingStop'
import { tutorRequiredItems } from '@/lib/profileRequired'
import {
  alertEmail,
  alertRoom,
  budgetWarning,
  digestDue,
  digestEmail,
  digestOn,
  DIGEST_KEY,
  DIGEST_LAST_KEY,
  LIMIT_BELL_KEY,
  OTP_ALERT_TEMPLATE,
  parseRecipients,
  RECIPIENTS_KEY,
  type AlertMember,
} from '@/lib/otpAlertsCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

async function setting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as string | null) ?? null
}

async function putSetting(admin: Admin, key: string, value: string, by: string | null = null): Promise<void> {
  await admin.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString(), ...(by ? { updated_by: by } : {}) }, { onConflict: 'key' })
}

/** The recipients' sending addresses: working staff only, real addresses only. */
async function recipientAddresses(admin: Admin, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data } = await admin.from('profiles').select('id, email, role, admin_role, is_suspended, former_staff_at').in('id', ids)
  return (data ?? [])
    .filter((p) => p.role === 'admin' && !!p.admin_role && !p.is_suspended && !p.former_staff_at)
    .map((p) => String(p.email ?? '').trim())
    .filter((e) => !!e && !isPlaceholder(e))
}

async function sentToday(admin: Admin): Promise<number> {
  const { count } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', utcDayStart())
  return count ?? 0
}

async function bellOwnerOnce(admin: Admin): Promise<void> {
  const day = utcDayStart().slice(0, 10)
  if ((await setting(admin, LIMIT_BELL_KEY)) === day) return
  await putSetting(admin, LIMIT_BELL_KEY, day)
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (data?.id)
    await notify({
      userId: data.id as string,
      kind: 'staff_alert',
      title: 'New-member alert emails paused for today',
      body: 'Today’s emails are close to the daily limit, so verified-member alerts stopped until tomorrow. Receipts, codes and member emails still go.',
      href: '/admin/settings/notifications',
    }).catch(() => undefined)
}

async function membersFor(admin: Admin, ids: string[]): Promise<Map<string, AlertMember>> {
  const out = new Map<string, AlertMember>()
  if (ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('profiles').select('id, full_name, display_name, role, city, created_at').in('id', part).order('id').range(from, to),
  )
  const tutorIds = rows.filter((r) => r.role === 'tutor').map((r) => r.id as string)
  const facts = tutorIds.length ? await flowFactsByTutor(admin, tutorIds).catch(() => new Map()) : new Map()
  for (const r of rows) {
    const role = r.role === 'tutor' ? 'tutor' : 'parent'
    const f = facts.get(r.id as string)
    const items = f ? tutorRequiredItems(f) : null
    out.set(r.id as string, {
      id: r.id as string,
      name: formatName(((r.display_name as string | null) || (r.full_name as string | null)) ?? '') || 'New member',
      role,
      city: (r.city as string | null) ?? null,
      signedUpAt: String(r.created_at),
      steps: role === 'tutor' && items ? { done: items.filter((i) => i.done).length, total: items.length } : null,
    })
  }
  return out
}

async function markRows(admin: Admin, ids: string[], status: string, emails = 0): Promise<void> {
  if (ids.length === 0) return
  await admin.from('otp_alerts').update({ status, sent_at: new Date().toISOString(), emails }).in('member_id', ids).eq('status', 'pending')
}

/** Send these pending alerts one by one (immediate mode). Never throws. */
async function sendNow(admin: Admin, memberIds: string[]): Promise<void> {
  const ids = parseRecipients(await setting(admin, RECIPIENTS_KEY))
  const to = await recipientAddresses(admin, ids)
  if (to.length === 0) return void (await markRows(admin, memberIds, 'no_recipients'))
  const limit = parseDailyLimit(await setting(admin, DAILY_LIMIT_KEY))
  const members = await membersFor(admin, memberIds)
  for (const id of memberIds) {
    const m = members.get(id)
    if (!m) continue
    if (!alertRoom(await sentToday(admin), to.length, limit)) {
      await markRows(admin, [id], 'held_limit')
      await bellOwnerOnce(admin)
      continue
    }
    const mail = alertEmail(m)
    let sent = 0
    for (const addr of to) {
      const r = await sendOne({ to: addr, subject: mail.subject, text: mail.text, html: mail.html, template: OTP_ALERT_TEMPLATE }, { job: OTP_ALERT_TEMPLATE })
      if (r.ok) sent++
    }
    await markRows(admin, [id], sent > 0 ? 'sent' : 'failed', sent)
  }
}

/** A member's mobile was verified for the first time. Never throws, never blocks the verify. */
export async function queueOtpAlert(memberId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data: p } = await admin.from('profiles').select('role, phone_verified_at, is_test_name, is_team_account, hidden_from_public').eq('id', memberId).maybeSingle()
    if (!p || (p.role !== 'tutor' && p.role !== 'parent' && p.role !== 'academy')) return
    // Test, team and hidden accounts are in no count and get no alert.
    if (p.is_test_name || p.is_team_account || p.hidden_from_public) return
    const { error } = await admin
      .from('otp_alerts')
      .insert({ member_id: memberId, role: p.role === 'tutor' ? 'tutor' : 'parent', verified_at: (p.phone_verified_at as string | null) ?? new Date().toISOString() })
    if (error) return // already alerted once (primary key) — a re-verification is not new
    if (digestOn(await setting(admin, DIGEST_KEY))) return // the cron sends the digest
    after(async () => {
      const a = createAdminClient()
      if (a) await sendNow(a, [memberId]).catch(() => undefined)
    })
  } catch {
    /* the 1-minute cron picks up anything pending */
  }
}

/** The 1-minute admin cron. Immediate mode: pending rows older than a minute
 *  (the after() send did not run). Digest mode: one digest every 15 minutes. */
export async function runOtpAlerts(nowMs = Date.now()): Promise<{ sent: number; held: number } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  try {
    const { data: pending } = await admin.from('otp_alerts').select('member_id, created_at').eq('status', 'pending').order('created_at').limit(200)
    const rows = pending ?? []
    if (rows.length === 0) return { sent: 0, held: 0 }
    if (!digestOn(await setting(admin, DIGEST_KEY))) {
      const stale = rows.filter((r) => nowMs - Date.parse(String(r.created_at)) > 60_000).map((r) => r.member_id as string)
      if (stale.length) await sendNow(admin, stale)
      return { sent: stale.length, held: 0 }
    }
    if (!digestDue(await setting(admin, DIGEST_LAST_KEY), nowMs)) return { sent: 0, held: 0 }
    await putSetting(admin, DIGEST_LAST_KEY, new Date(nowMs).toISOString())
    const ids = rows.map((r) => r.member_id as string)
    const to = await recipientAddresses(admin, parseRecipients(await setting(admin, RECIPIENTS_KEY)))
    if (to.length === 0) {
      await markRows(admin, ids, 'no_recipients')
      return { sent: 0, held: 0 }
    }
    const limit = parseDailyLimit(await setting(admin, DAILY_LIMIT_KEY))
    if (!alertRoom(await sentToday(admin), to.length, limit)) {
      await markRows(admin, ids, 'held_limit')
      await bellOwnerOnce(admin)
      return { sent: 0, held: ids.length }
    }
    const members = [...(await membersFor(admin, ids)).values()]
    const mail = digestEmail(members)
    let sent = 0
    for (const addr of to) {
      const r = await sendOne({ to: addr, subject: mail.subject, text: mail.text, html: mail.html, template: OTP_ALERT_TEMPLATE }, { job: OTP_ALERT_TEMPLATE })
      if (r.ok) sent++
    }
    await markRows(admin, ids, sent > 0 ? 'digest_sent' : 'failed', sent)
    return { sent, held: 0 }
  } catch {
    return null
  }
}

// ------------------------------------------------------------ the setting ---

export type OtpAlertSettings = {
  staff: { id: string; name: string; role: string; isOwner: boolean; checked: boolean }[]
  digest: boolean
  alertsToday: number
  emailsToday: number
  dailyLimit: number
  warning: string | null
}

export async function loadOtpAlertSettings(): Promise<OtpAlertSettings | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [recip, dig, lim, staff, alertsToday, emailsToday, week, weekAlerts, verified] = await Promise.all([
    setting(admin, RECIPIENTS_KEY),
    setting(admin, DIGEST_KEY),
    setting(admin, DAILY_LIMIT_KEY),
    admin.from('profiles').select('id, full_name, admin_role, is_suspended, former_staff_at').eq('role', 'admin').not('admin_role', 'is', null),
    admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').eq('template', OTP_ALERT_TEMPLATE).gte('created_at', utcDayStart()),
    sentToday(admin),
    admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', weekAgo),
    admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').eq('template', OTP_ALERT_TEMPLATE).gte('created_at', weekAgo),
    admin.from('profiles').select('id', { count: 'exact', head: true }).gte('phone_verified_at', weekAgo).in('role', ['tutor', 'parent', 'academy']),
  ])
  const chosen = new Set(parseRecipients(recip))
  const dailyLimit = parseDailyLimit(lim)
  const list = (staff.data ?? [])
    .filter((p) => !p.is_suspended && !p.former_staff_at)
    .map((p) => ({
      id: p.id as string,
      name: formatName((p.full_name as string | null) ?? '') || 'Staff',
      role: String(p.admin_role),
      isOwner: p.admin_role === 'owner',
      checked: chosen.has(String(p.id).toLowerCase()),
    }))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name))
  const otherPerDay = Math.max(0, ((week.count ?? 0) - (weekAlerts.count ?? 0)) / 7)
  const digest = digestOn(dig)
  return {
    staff: list,
    digest,
    alertsToday: alertsToday.count ?? 0,
    emailsToday,
    dailyLimit,
    warning: budgetWarning({ otherPerDay, verifiedPerDay: (verified.count ?? 0) / 7, recipients: list.filter((s) => s.checked).length, digest, dailyLimit }),
  }
}

/** Owner only (the route checks): who gets the alerts, and digest on/off. */
export async function saveOtpAlertSettings(actor: AdminActor, a: { recipients: string[]; digest: boolean }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: staff } = await admin.from('profiles').select('id').eq('role', 'admin').not('admin_role', 'is', null).in('id', a.recipients.length ? a.recipients : ['00000000-0000-0000-0000-000000000000'])
  const valid = (staff ?? []).map((s) => String(s.id).toLowerCase())
  const before = { recipients: parseRecipients(await setting(admin, RECIPIENTS_KEY)), digest: digestOn(await setting(admin, DIGEST_KEY)) }
  await putSetting(admin, RECIPIENTS_KEY, JSON.stringify(valid), actor.id)
  await putSetting(admin, DIGEST_KEY, a.digest ? 'on' : 'off', actor.id)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'settings.otp_alerts',
    targetType: 'setting',
    targetId: RECIPIENTS_KEY,
    detail: { from: before, to: { recipients: valid, digest: a.digest } },
  })
  return { ok: true }
}
