import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { deliverEmail } from '@/lib/notify'
import { normalisePkMobile, isSyntheticEmail } from '@/lib/phone'
import { whatsappHref } from '@/lib/support'
import { absoluteUrl } from '@/lib/siteUrl'
import { citySegment } from '@/lib/slugs'
import type { AdminRole } from '@/lib/adminAuth'

// The official TutorMint Team ↔ member channel (owner, Sunday 6 Sep).
//
// A DEDICATED store (admin_messages), deliberately NOT the member↔member
// `threads` table. That table's privacy line — "there is no chat-browsing
// screen; member conversations are only ever read on /admin/reports for a
// reported thread" — stays true by construction: /admin/inbox reads
// admin_messages, which only ever holds Team↔member official messages. The
// member never sees which admin sent an 'out' message; it is always "TutorMint
// Team".
//
// A send does three things (owner spec): an in-app notification, this thread,
// and an email — plus an audit row and a member-timeline entry.

export const TEAM_NAME = 'TutorMint Team'

export type AdminTemplate = {
  key: string
  title: string
  subject: string
  body: string
}

export type AdminMessage = {
  id: string
  direction: 'out' | 'in'
  body: string
  templateKey: string | null
  createdAt: string
  readAt: string | null
}

/** Fill {name} / {job_title} / {reason} in a template body. */
export function fillPlaceholders(
  body: string,
  vars: { name?: string; jobTitle?: string; reason?: string },
): string {
  return body
    .replace(/\{name\}/g, vars.name ?? '')
    .replace(/\{job_title\}/g, vars.jobTitle ?? '')
    .replace(/\{reason\}/g, vars.reason ?? '')
}

export async function loadTemplates(): Promise<AdminTemplate[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('admin_message_templates')
    .select('key, title, subject, body')
    .order('title')
  return (data ?? []) as AdminTemplate[]
}

export async function saveTemplate(
  t: AdminTemplate,
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'Server is not configured.' }
  const { error } = await admin
    .from('admin_message_templates')
    .update({ title: t.title, subject: t.subject, body: t.body, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq('key', t.key)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** One member's official conversation, oldest first. */
export async function loadConversation(memberId: string): Promise<AdminMessage[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('admin_messages')
    .select('id, direction, body, template_key, created_at, read_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: true })
  return (data ?? []).map((m) => ({
    id: m.id as string,
    direction: m.direction as 'out' | 'in',
    body: m.body as string,
    templateKey: (m.template_key as string) ?? null,
    createdAt: m.created_at as string,
    readAt: (m.read_at as string) ?? null,
  }))
}

/**
 * The member's side of the Team channel, folded to one summary for the inbox's
 * pinned row (owner, Part 5 — Team messages live in the role inbox now). Unread
 * counts the Team's own 'out' messages the member has not read, from the store
 * itself, so the pinned row's dot cannot disagree with the conversation.
 */
export type TeamSummary = {
  hasAny: boolean
  lastBody: string | null
  lastAt: string | null
  unread: number
}

export async function loadTeamSummary(memberId: string): Promise<TeamSummary> {
  const admin = createAdminClient()
  if (!admin) return { hasAny: false, lastBody: null, lastAt: null, unread: 0 }

  const { data: rows } = await admin
    .from('admin_messages')
    .select('direction, body, created_at, read_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!rows || rows.length === 0) return { hasAny: false, lastBody: null, lastAt: null, unread: 0 }

  const unread = rows.filter((r) => r.direction === 'out' && !r.read_at).length
  const last = rows[0]
  return {
    hasAny: true,
    lastBody: (last.body as string) ?? null,
    lastAt: (last.created_at as string) ?? null,
    unread,
  }
}

/** How many official Team messages this member has not read. */
export async function teamUnreadCount(memberId: string): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin
    .from('admin_messages')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('direction', 'out')
    .is('read_at', null)
  return count ?? 0
}

export type InboxThread = {
  memberId: string
  memberName: string
  memberEmail: string
  lastBody: string
  lastAt: string
  lastDirection: 'out' | 'in'
  unreadFromMember: number
}

/** The inbox list: one row per member with any official message, newest first. */
export async function loadInboxThreads(limit = 100): Promise<InboxThread[]> {
  const admin = createAdminClient()
  if (!admin) return []

  // Small volume; pull recent messages and fold to one row per member.
  const { data: rows } = await admin
    .from('admin_messages')
    .select('member_id, direction, body, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (!rows || rows.length === 0) return []

  const byMember = new Map<string, InboxThread>()
  for (const r of rows) {
    const id = r.member_id as string
    let t = byMember.get(id)
    if (!t) {
      t = {
        memberId: id,
        memberName: '—',
        memberEmail: '—',
        lastBody: r.body as string,
        lastAt: r.created_at as string,
        lastDirection: r.direction as 'out' | 'in',
        unreadFromMember: 0,
      }
      byMember.set(id, t)
    }
    if (r.direction === 'in' && !r.read_at) t.unreadFromMember += 1
  }

  const ids = [...byMember.keys()].slice(0, limit)
  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  for (const p of people ?? []) {
    const t = byMember.get(p.id as string)
    if (t) {
      t.memberName = (p.full_name as string) ?? '—'
      t.memberEmail = (p.email as string) ?? '—'
    }
  }

  return ids.map((id) => byMember.get(id)!).filter(Boolean)
}

/** The delivery channel for an official message. */
export type AdminMessageChannel = 'inapp' | 'whatsapp'

/**
 * Send an official message from the Team to a member (admin path).
 *
 * `channel` chooses how it is delivered, and both channels share EVERYTHING
 * else — the same template body, the same admin_messages thread record, the
 * same audit log and the same member-timeline entry (owner, 9 Sep):
 *
 *   'inapp'    — the original: an in-app notification + an email (+ the record).
 *   'whatsapp' — WhatsApp is the platform's live channel but there is no
 *                outbound WhatsApp API here (SMS Point is OTP-only), so this
 *                returns a wa.me link the ADMIN clicks to actually send. It does
 *                NOT auto-send in-app/email — those are the other channel — but
 *                it records, audits and timelines identically. Refused when the
 *                member has no mobile on file: we never message a number the
 *                member did not give.
 */
export async function sendAdminMessage(params: {
  memberId: string
  body: string
  templateKey?: string | null
  channel?: AdminMessageChannel
  actor: { id: string; adminRole: AdminRole; email: string | null }
}): Promise<{ ok: true; waHref?: string | null } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const channel: AdminMessageChannel = params.channel ?? 'inapp'
  const body = params.body.trim()
  if (body.length < 2) return { ok: false, status: 400, error: 'Write a message.' }

  const { data: member } = await admin
    .from('profiles')
    .select('id, full_name, phone_number, whatsapp, email')
    .eq('id', params.memberId)
    .maybeSingle()
  if (!member) return { ok: false, status: 404, error: 'Member not found.' }

  // For WhatsApp we need a number the member actually gave. Prefer their stated
  // WhatsApp number, fall back to their mobile; refuse if there is neither.
  let waHref: string | null = null
  if (channel === 'whatsapp') {
    const msisdn =
      normalisePkMobile(member.whatsapp as string | null) ??
      normalisePkMobile(member.phone_number as string | null)
    if (!msisdn) {
      return {
        ok: false,
        status: 400,
        error: 'This member has no mobile number on file, so there is no WhatsApp to send to.',
      }
    }
    waHref = whatsappHref(msisdn, body)
  }

  const { error } = await admin.from('admin_messages').insert({
    member_id: params.memberId,
    direction: 'out',
    admin_id: params.actor.id,
    template_key: params.templateKey ?? null,
    body,
  })
  if (error) return { ok: false, status: 400, error: error.message }

  // The in-app channel also pushes a notification and an email. WhatsApp is
  // delivered by the admin clicking the returned link, so it skips those — but
  // the thread record above, the audit below and the timeline below are shared.
  if (channel === 'inapp') {
    await notify({
      userId: params.memberId,
      kind: 'admin_message',
      title: `Message from ${TEAM_NAME}`,
      body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      href: '/account/messages',
    })
    // Never email a SYNTHETIC address (<msisdn>@users.tutormint.org) — it accepts
    // no mail, so a "send" there is a silent nothing. A mobile-signup member is
    // reached on WhatsApp, not by email; the in-app notification still lands.
    // (The outreach view already routes mobile accounts to the WhatsApp channel;
    // this is the belt-and-braces so no caller can email a number's synthetic.)
    if (!isSyntheticEmail((member.email as string | null) ?? '')) {
      await deliverEmail({ userId: params.memberId }, { id: 'admin_message', body })
    }
  }

  // Audit + member timeline — the same for both channels, with the channel
  // recorded so "sent on WhatsApp" is visible and reviewable.
  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.message',
    targetType: 'profile',
    targetId: params.memberId,
    detail: { templateKey: params.templateKey ?? null, length: body.length, channel },
  })
  await logActivity({
    userId: params.memberId,
    event: 'admin_message_received',
    targetType: 'profile',
    targetId: params.memberId,
    meta: { templateKey: params.templateKey ?? null, channel },
  })

  return { ok: true, waHref }
}

// Fallback if the template row is missing (a fresh env before migration 65).
// No promise of a tutor, an outcome or a timeframe; no price.
const SEEDED_LIVE_FALLBACK =
  'Hi {name}, your tuition is now live on TutorMint and verified tutors browsing the site can see it here: {tuition_url}. If you would like to post and manage your own tuitions next time, you can create a free account at tutormint.org.'

/**
 * WhatsApp a seeded tuition's real parent that their post is live, with a link
 * to it (owner). The parent has NO account, so this is a WhatsApp-only send to
 * the number stored in job_contacts — it builds the wa.me link the admin clicks
 * to deliver it, and records the action in the audit log and on the team
 * account's timeline (the only member in the loop). It refuses if the job has no
 * stored contact number. The message never promises a tutor, an outcome or a
 * timeframe, and mentions no price.
 */
export async function messageSeededParent(
  jobId: string,
  actor: { id: string; adminRole: AdminRole; email: string | null },
): Promise<{ ok: true; waHref: string } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: job } = await admin
    .from('jobs')
    .select('id, parent_id, public_slug, city, title')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'Tuition not found.' }

  const { data: contact } = await admin
    .from('job_contacts')
    .select('contact_name, contact_phone')
    .eq('job_id', jobId)
    .maybeSingle()

  const msisdn = normalisePkMobile((contact?.contact_phone as string | null) ?? null)
  if (!msisdn) {
    return {
      ok: false,
      status: 400,
      error: 'This tuition has no parent contact number on file, so there is no WhatsApp to send to.',
    }
  }

  const name = ((contact?.contact_name as string | null) ?? '').trim() || 'there'
  const tuitionUrl = job.public_slug
    ? absoluteUrl(`/tuitions/${citySegment(job.city as string | null)}/${job.public_slug as string}`)
    : absoluteUrl('/browse/tuitions')

  const { data: template } = await admin
    .from('admin_message_templates')
    .select('body')
    .eq('key', 'seeded_tuition_live')
    .maybeSingle()

  const body = ((template?.body as string | null) ?? SEEDED_LIVE_FALLBACK)
    .replaceAll('{name}', name)
    .replaceAll('{tuition_url}', tuitionUrl)

  const waHref = whatsappHref(msisdn, body)
  if (!waHref) return { ok: false, status: 400, error: 'Could not build the WhatsApp link.' }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'job.contact_message',
    targetType: 'job',
    targetId: jobId,
    detail: { templateKey: 'seeded_tuition_live', channel: 'whatsapp' },
  })

  // Timeline lands on the team account (the job's owner), the only member in the
  // loop — the recipient is a seeded parent with no account of their own.
  await logActivity({
    userId: job.parent_id as string,
    event: 'seeded_contact_messaged',
    targetType: 'job',
    targetId: jobId,
    meta: { channel: 'whatsapp', byAdmin: actor.id },
  })

  return { ok: true, waHref }
}

/** A member's reply into their official conversation (member path). */
export async function replyToTeam(params: {
  memberId: string
  body: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const body = params.body.trim()
  if (body.length < 1) return { ok: false, status: 400, error: 'Write a reply.' }
  if (body.length > 4000) return { ok: false, status: 400, error: 'That reply is too long.' }

  const { error } = await admin.from('admin_messages').insert({
    member_id: params.memberId,
    direction: 'in',
    body,
  })
  if (error) return { ok: false, status: 400, error: error.message }
  return { ok: true }
}

/** Mark the member's 'in' replies read (admin opened the thread). */
export async function markMemberRepliesRead(memberId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('admin_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('member_id', memberId)
    .eq('direction', 'in')
    .is('read_at', null)
}

/** Mark the Team's 'out' messages read (member opened their conversation). */
export async function markTeamMessagesRead(memberId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('admin_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('member_id', memberId)
    .eq('direction', 'out')
    .is('read_at', null)
}
