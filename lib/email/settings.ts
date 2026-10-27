import 'server-only'

// lib/email/settings.ts — Notification settings and Email usage (owner, 27 Oct
// 2026). Rules in lib/email/policyCore.ts and lib/email/usageCore.ts. Service
// role. Every switch change is in Audit (settings.email_type). Never logs an
// address.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { pageAll } from '@/lib/pageAll'
import {
  DAILY_LIMIT_KEY,
  EMAIL_TYPE_KEY_PREFIX,
  EMAIL_TYPE_LABEL,
  LOCKED_ON,
  MEMBER_TEMPLATES,
  STAFF_TEMPLATES,
  defaultOn,
  parseDailyLimit,
  typeOn,
} from './policyCore'
import { usageTable, type UsageRow, type UsageSend } from './usageCore'

export type EmailTypeRow = { id: string; label: string; group: 'staff' | 'member' | 'signin'; on: boolean; locked: boolean; defaultOn: boolean }

export async function loadEmailTypes(): Promise<{ types: EmailTypeRow[]; dailyLimit: number }> {
  const admin = createAdminClient()
  const stored = new Map<string, string | null>()
  if (admin) {
    const { data } = await admin.from('app_settings').select('key, value').or(`key.like.${EMAIL_TYPE_KEY_PREFIX}%,key.eq.${DAILY_LIMIT_KEY}`)
    for (const r of data ?? []) stored.set(r.key as string, (r.value as string | null) ?? null)
  }
  const row = (id: string, group: EmailTypeRow['group']): EmailTypeRow => ({
    id,
    label: EMAIL_TYPE_LABEL[id] ?? id,
    group,
    on: typeOn(id, stored.get(`${EMAIL_TYPE_KEY_PREFIX}${id}`)),
    locked: LOCKED_ON.has(id),
    defaultOn: LOCKED_ON.has(id) || defaultOn(id),
  })
  const signin = ['password_reset', 'confirm_email', 'account_erased'].map((id) => row(id, 'signin'))
  const staff = STAFF_TEMPLATES.map((id) => row(id, 'staff'))
  const member = MEMBER_TEMPLATES.filter((id) => !LOCKED_ON.has(id)).map((id) => row(id, 'member'))
  return { types: [...signin, ...staff, ...member], dailyLimit: parseDailyLimit(stored.get(DAILY_LIMIT_KEY)) }
}

const KNOWN = new Set<string>([...STAFF_TEMPLATES, ...MEMBER_TEMPLATES, 'password_reset'])

export async function setEmailType(actor: AdminActor, id: string, on: boolean): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!KNOWN.has(id)) return { ok: false, status: 400, error: 'That email type is not known.' }
  if (LOCKED_ON.has(id)) return { ok: false, status: 400, error: 'This email is needed to sign in, so it always stays on.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const key = `${EMAIL_TYPE_KEY_PREFIX}${id}`
  const { data: before } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const from = typeOn(id, (before?.value as string | null) ?? null)
  const { error } = await admin.from('app_settings').upsert({ key, value: on ? 'on' : 'off' }, { onConflict: 'key' })
  if (error) return { ok: false, status: 500, error: 'That did not save. Try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'settings.email_type',
    targetType: 'app_settings',
    targetId: key,
    detail: { type: id, from: from ? 'on' : 'off', to: on ? 'on' : 'off' },
  })
  return { ok: true }
}

export async function setDailyLimit(actor: AdminActor, limit: number): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) return { ok: false, status: 400, error: 'Enter a whole number of emails a day.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: before } = await admin.from('app_settings').select('value').eq('key', DAILY_LIMIT_KEY).maybeSingle()
  const { error } = await admin.from('app_settings').upsert({ key: DAILY_LIMIT_KEY, value: String(limit) }, { onConflict: 'key' })
  if (error) return { ok: false, status: 500, error: 'That did not save. Try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'settings.email_daily_limit',
    targetType: 'app_settings',
    targetId: DAILY_LIMIT_KEY,
    detail: { from: parseDailyLimit((before?.value as string | null) ?? null), to: limit },
  })
  return { ok: true }
}

/** The last `days` days of email_sends, per UTC day and type
 *  (Resend's limit is a UTC day). Addresses are never read into the result. */
export async function loadEmailUsage(days = 30, now = new Date()): Promise<UsageRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const rows = await pageAll<{ id: string; created_at: string; template: string | null; job: string; status: string; error: string | null }>((from, to) =>
    admin.from('email_sends').select('id, created_at, template, job, status, error').gte('created_at', since).order('created_at').order('id').range(from, to),
  )
  return usageTable(rows.map((r): UsageSend => ({ at: r.created_at, template: r.template ?? r.job, status: r.status, reason: r.error })))
}
