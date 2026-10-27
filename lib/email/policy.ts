// lib/email/policy.ts — the facts the email rules need, read once per send
// (owner, 27 Oct 2026). Rules in lib/email/policyCore.ts. Service role.
//
// FAILS OPEN on a database error: a wobble must never stop a password reset
// or a receipt. (The daily-limit count then reads 0 for that one send.)
// Never logs an address.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  DAILY_LIMIT_KEY,
  DUPLICATE_WINDOW_MS,
  EMAIL_TYPE_KEY_PREFIX,
  NO_FACTS,
  OPEN_TRACKING_KEY,
  normaliseAddress,
  parseDailyLimit,
  typeOn,
  unopenedStreak,
  type PolicyFacts,
  type PolicyMessage,
} from './policyCore'

export function addressHash(address: string): string {
  return createHash('sha256').update(`tm-email:${normaliseAddress(address)}`).digest('hex')
}

/** UTC midnight today — Resend counts its daily limit by UTC day. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Is open tracking active? Both the Owner's flag (set once Resend's domain has
 *  open tracking on) and the webhook secret (opens arrive only through it). */
export function trackingConfigured(flag: string | null | undefined): boolean {
  return !!process.env.RESEND_WEBHOOK_SECRET && String(flag ?? '').trim().toLowerCase() === 'on'
}

export async function loadFacts(messages: readonly PolicyMessage[], now = new Date()): Promise<PolicyFacts> {
  const admin = createAdminClient()
  if (!admin || messages.length === 0) return NO_FACTS
  const addrs = [...new Set(messages.map((m) => normaliseAddress(m.to ?? '')).filter(Boolean))]
  const templates = [...new Set(messages.map((m) => m.template ?? 'email'))]
  try {
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString()
    const [settings, dne, unconf, recent, today] = await Promise.all([
      admin.from('app_settings').select('key, value').or(`key.like.${EMAIL_TYPE_KEY_PREFIX}%,key.eq.${DAILY_LIMIT_KEY},key.eq.${OPEN_TRACKING_KEY}`),
      admin.from('email_do_not_send').select('address_hash').is('removed_at', null).in('address_hash', addrs.map(addressHash)),
      admin.from('profiles').select('email').eq('email_pending_confirm', true).in('email', addrs),
      admin.from('email_sends').select('recipient, template').eq('status', 'sent').gte('created_at', since).in('recipient', addrs).in('template', templates),
      admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', utcDayStart(now).toISOString()),
    ])
    const stored = new Map((settings.data ?? []).map((r) => [r.key as string, r.value as string | null]))
    const typeOff = new Set<string>()
    for (const t of templates) if (!typeOn(t, stored.get(`${EMAIL_TYPE_KEY_PREFIX}${t}`))) typeOff.add(t)
    const hashBy = new Map(addrs.map((a) => [addressHash(a), a]))
    const trackingActive = trackingConfigured(stored.get(OPEN_TRACKING_KEY))
    const unopened = new Map<string, number>()
    if (trackingActive) {
      const { data: hist } = await admin
        .from('email_sends')
        .select('recipient, template, opened_at, created_at')
        .eq('status', 'sent')
        .not('provider_id', 'is', null)
        .in('recipient', addrs)
        .in('template', templates)
        .order('created_at', { ascending: false })
        .limit(1000)
      const by = new Map<string, { openedAt: string | null }[]>()
      for (const h of hist ?? []) {
        const k = `${h.template}|${normaliseAddress(h.recipient as string)}`
        const list = by.get(k) ?? []
        list.push({ openedAt: (h.opened_at as string | null) ?? null })
        by.set(k, list)
      }
      for (const [k, list] of by) unopened.set(k, unopenedStreak(list))
    }
    return {
      typeOff,
      doNotEmail: new Set((dne.data ?? []).map((r) => hashBy.get(r.address_hash as string)).filter((x): x is string => !!x)),
      unconfirmed: new Set((unconf.data ?? []).map((r) => normaliseAddress((r.email as string) ?? '')).filter(Boolean)),
      recent: new Set((recent.data ?? []).map((r) => `${r.template}|${normaliseAddress(r.recipient as string)}`)),
      unopened,
      trackingActive,
      sentToday: today.count ?? 0,
      limit: parseDailyLimit(stored.get(DAILY_LIMIT_KEY)),
    }
  } catch {
    console.warn('[email-policy] facts unreadable; sending without the saving rules')
    return NO_FACTS
  }
}

export type QueueItem = {
  kind: 'daily_limit' | 'summary'
  template: string | null
  recipient: string
  subject: string
  text: string
  html?: string
}

export async function enqueue(items: QueueItem[], now = new Date()): Promise<void> {
  if (items.length === 0) return
  const admin = createAdminClient()
  if (!admin) return
  const tomorrow = new Date(utcDayStart(now).getTime() + 86_400_000).toISOString()
  const rows = items.map((i) => ({
    kind: i.kind,
    template: i.template,
    recipient: i.recipient,
    subject: i.subject,
    body_text: i.text,
    body_html: i.kind === 'daily_limit' ? (i.html ?? null) : null,
    due_at: i.kind === 'daily_limit' ? tomorrow : now.toISOString(),
  }))
  const { error } = await admin.from('email_queue').insert(rows)
  if (error) console.error('[email-policy] could not hold emails for later:', error.message)
}
