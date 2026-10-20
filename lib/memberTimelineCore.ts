// lib/memberTimelineCore.ts
//
// ONE timeline on the admin member page (owner, 20 Oct 2026). It used to be
// three boxes saying the same things: "Admin actions about them" (the audit
// log), "Activity" (sessions and pages) and "Timeline" (the member's own
// event log). Now every source feeds one list with the existing tabs:
//
//   Everything  all of it
//   Account     sign-up, sign-in, profile and document events
//   Activity    a one-line summary, then sessions (tap to see the pages)
//   Money       payments and plans
//   Moderation  every admin action, with who did it
//
// Rules:
//   • An admin action logs two rows (the audit row and the member's own event
//     row). The audit row — which names who did it — is kept; its twin is
//     dropped (dedupeAgainstAudit).
//   • Event names are specific: "Approved CNIC", "Approved profile picture",
//     "Approved selfie" — not "Approved a tutor" three times (auditSentence).
//   • Repeats in a row become one line, "Updated their profile ×8 (10:46–10:53
//     pm)", tap to expand (groupRepeats).
//   • The header count, the list and the closing "That's the whole timeline —
//     N events" are all the length of the SAME grouped list, so they agree.
//
// Nothing stored is changed or deleted — this only decides what is shown.
// PURE — unit-tested by scripts/test-admin-cleanup.ts.

import { adminActionLabel } from '@/lib/display'
import { formatTime, formatDate } from '@/lib/datetime'
import { collapseTimeline, timelineSentence, type TimelineMeta } from '@/lib/timelineText'

export type TimelineGroup = 'all' | 'account' | 'activity' | 'money' | 'moderation'
export const TIMELINE_TABS: { key: TimelineGroup; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'account', label: 'Account' },
  { key: 'activity', label: 'Activity' },
  { key: 'money', label: 'Money' },
  { key: 'moderation', label: 'Moderation' },
]

export function parseTimelineGroup(v: string | null | undefined): TimelineGroup {
  return TIMELINE_TABS.some((t) => t.key === v) ? (v as TimelineGroup) : 'all'
}

/** Which tab a member's OWN event row belongs to. */
export const TIMELINE_GROUPS: Record<Exclude<TimelineGroup, 'all'>, string[]> = {
  account: [
    'registered', 'email_confirmed', 'login', 'otp_verified', 'profile_updated',
    'completion_changed', 'subjects_changed', 'document_uploaded', 'video_submitted',
    'verification_submitted', 'verification_decision_received', 'video_visibility_changed',
    'admin_message_received', 'password_changed', 'terms_accepted', 'profile_claimed',
  ],
  activity: [
    'job_posted', 'job_edited', 'job_closed', 'application_submitted', 'application_withdrawn',
    'demo_requested', 'demo_accepted', 'demo_declined', 'demo_completed', 'message_sent',
    'shortlist_added', 'shortlist_removed', 'profile_viewed', 'search_performed',
    'saved_job_added', 'saved_job_removed', 'cv_downloaded',
  ],
  money: [
    'payment_submitted', 'payment_rejected', 'payment_approved', 'verification_fee_paid', 'plan_purchased',
    'plan_expiring', 'plan_granted', 'plan_revoked', 'plan_expired', 'checkout_cancelled',
  ],
  moderation: [
    'blocked', 'blocked_by', 'unblocked', 'reported', 'reported_by', 'report_resolved',
    'warned', 'suspended', 'unsuspended', 'banned', 'unbanned', 'staff_created',
    'staff_role_changed', 'staff_suspended', 'staff_reactivated', 'document_unlocked',
    'follow_up_sent', 'follow_up_undone',
  ],
}

export function groupOfEvent(event: string): Exclude<TimelineGroup, 'all'> | null {
  for (const g of Object.keys(TIMELINE_GROUPS) as (keyof typeof TIMELINE_GROUPS)[]) {
    if (TIMELINE_GROUPS[g].includes(event)) return g
  }
  return null
}

// ── Inputs ──────────────────────────────────────────────────────────────

export type LogRow = { id: string; event: string; meta: TimelineMeta; at: string }
export type AuditRow = {
  id: string
  action: string
  detail: Record<string, unknown> | null
  at: string
  /** The staff member's name (never an email); null for the system. */
  actorName: string | null
}
export type SessionRow = { id: string; startedAt: string; activeMs: number; pageCount: number }

// ── Specific names for admin actions ────────────────────────────────────

const ITEM_NAME: Record<string, string> = {
  cnic: 'CNIC',
  profile_pic: 'profile picture',
  profile_picture: 'profile picture',
  photo: 'profile picture',
  selfie: 'selfie',
  address: 'home address',
  video: 'introduction video',
}

const itemOf = (detail: Record<string, unknown> | null): string | null => {
  const v = detail?.item
  return typeof v === 'string' && ITEM_NAME[v] ? ITEM_NAME[v] : null
}

/** "Approved CNIC", "Rejected selfie", "Unlocked profile picture for re-upload". */
export function auditSentence(action: string, detail: Record<string, unknown> | null): string {
  const item = itemOf(detail)
  switch (action) {
    case 'tutor.approve':
    case 'parent.verify.approve':
      return item ? `Approved ${item}` : action === 'tutor.approve' ? 'Approved the tutor' : 'Approved parent verification'
    case 'tutor.hold':
    case 'parent.verify.reject':
      return item ? `Rejected ${item}` : action === 'tutor.hold' ? 'Put the introduction video on hold' : 'Rejected parent verification'
    case 'document.unlock':
      return item ? `Unlocked ${item} for re-upload` : 'Unlocked a document for re-upload'
    case 'cnic.reveal':
      return 'Showed the full CNIC number'
    case 'staff.signup_credit':
      return 'Sign-up credited to a staff member'
    case 'staff.signup_claim':
      return 'Staff claimed this sign-up'
    case 'staff.signup_claim_approve':
      return 'Staff sign-up claim approved'
    case 'staff.signup_claim_reject':
      return 'Staff sign-up claim rejected'
    case 'member.warn':
      return 'Warned'
    case 'member.suspend':
      return 'Suspended'
    case 'member.unsuspend':
      return 'Reinstated'
    case 'member.ban':
      return 'Banned for fraud'
    case 'member.unban':
      return 'Ban lifted'
    case 'member.follow_up':
      return 'Followed up'
    case 'document.rotate':
      return 'Turned a document image'
    case 'profile_photo.rotate':
      return 'Turned the profile picture'
    case 'profile_photo.crop':
      return 'Cropped the profile picture'
    case 'profile_photo.crop_reset':
      return 'Reset the profile picture crop'
    default:
      return adminActionLabel(action)
  }
}

// ── Dropping the member-side twin of an admin action ────────────────────

const TWIN: Record<string, (a: AuditRow, l: LogRow) => boolean> = {
  verification_decision_received: (a, l) => {
    const approve = a.action === 'tutor.approve' || a.action === 'parent.verify.approve'
    const reject = a.action === 'tutor.hold' || a.action === 'parent.verify.reject'
    if (!approve && !reject) return false
    const d = String(l.meta.decision ?? '')
    if (approve !== (d === 'approve')) return false
    const li = itemOf({ item: l.meta.item })
    const ai = itemOf(a.detail)
    return li === ai
  },
  warned: (a) => a.action === 'member.warn',
  suspended: (a) => a.action === 'member.suspend',
  unsuspended: (a) => a.action === 'member.unsuspend',
  banned: (a) => a.action === 'member.ban',
  unbanned: (a) => a.action === 'member.unban',
  document_unlocked: (a, l) => a.action === 'document.unlock' && itemOf(a.detail) === itemOf({ item: l.meta.item }),
  plan_granted: (a) => a.action === 'plan.grant',
  plan_revoked: (a) => a.action === 'plan.revoke',
  admin_message_received: (a) => a.action === 'member.message',
  follow_up_sent: (a) => a.action === 'member.follow_up',
}

/** How close (ms) an audit row and its twin event are written. */
export const TWIN_WINDOW_MS = 5 * 60 * 1000

export function dedupeAgainstAudit(logs: LogRow[], audits: AuditRow[]): LogRow[] {
  const used = new Set<string>()
  return logs.filter((l) => {
    const match = TWIN[l.event]
    if (!match) return true
    const t = Date.parse(l.at)
    const twin = audits.find(
      (a) => !used.has(a.id) && Math.abs(Date.parse(a.at) - t) <= TWIN_WINDOW_MS && match(a, l),
    )
    if (!twin) return true
    used.add(twin.id)
    return false
  })
}

// ── The list ────────────────────────────────────────────────────────────

export type TimelineTone = 'red' | 'gold' | 'green' | 'grey'

export type TimelineChild = { id: string; text: string; at: string; who: string | null }

export type TimelineItem = {
  id: string
  /** Newest time in the item. */
  at: string
  text: string
  /** "by <name>" for an admin action. */
  who: string | null
  tone: TimelineTone
  /** How many events this one line stands for (1 unless grouped). */
  count: number
  /** "10:46–10:53 pm" for a grouped line. */
  range: string | null
  children: TimelineChild[] | null
  /** A visit: tap to see the pages (loaded when opened). */
  sessionId: string | null
}

const RED = new Set(['suspended', 'banned', 'member.suspend', 'member.ban', 'tutor.hold', 'parent.verify.reject'])
const GOLD = new Set(['warned', 'reported_by', 'member.warn', 'document.unlock', 'cnic.reveal'])
const GREEN = new Set([
  'unsuspended', 'plan_purchased', 'verification_fee_paid', 'payment_approved', 'member.unsuspend',
  'member.unban', 'tutor.approve', 'parent.verify.approve', 'plan.grant', 'payment.approve',
])
const toneOf = (key: string): TimelineTone => (RED.has(key) ? 'red' : GOLD.has(key) ? 'gold' : GREEN.has(key) ? 'green' : 'grey')

/** "Visited TutorMint — 6 min · 4 pages". */
export function sessionSentence(s: SessionRow): string {
  const sec = Math.round((s.activeMs || 0) / 1000)
  const dur = sec < 60 ? `${sec} sec` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`
  return `Visited TutorMint — ${dur} · ${s.pageCount} page${s.pageCount === 1 ? '' : 's'}`
}

type Flat = { item: TimelineItem; group: Exclude<TimelineGroup, 'all'> | null; key: string | null }

/** Grouping key for an event: same key, in a row → one line. */
function repeatKey(event: string, text: string): string {
  return event === 'profile_updated' ? 'profile_updated' : `${event}|${text}`
}

/** Neighbours further apart than this are not "in a row". */
export const REPEAT_GAP_MS = 60 * 60 * 1000

/** "10:46–10:53 pm" (Pakistan time); the date is added when the run spans days. */
export function timeRange(oldest: string, newest: string): string {
  const a = formatTime(oldest)
  const b = formatTime(newest)
  const da = formatDate(oldest)
  const db = formatDate(newest)
  if (da !== db) return `${da}, ${a} – ${db}, ${b}`
  const sa = a.slice(-2)
  const sb = b.slice(-2)
  const left = sa === sb && /[ap]m$/i.test(a) ? a.slice(0, -2).trim() : a
  return `${left}–${b}`
}

/** Merge runs of the same event in a row into one line with ×N. */
export function groupRepeats(rows: Flat[]): Flat[] {
  const out: Flat[] = []
  let i = 0
  while (i < rows.length) {
    const head = rows[i]
    let j = i
    if (head.key) {
      while (
        j + 1 < rows.length &&
        rows[j + 1].key === head.key &&
        Math.abs(Date.parse(rows[j].item.at) - Date.parse(rows[j + 1].item.at)) <= REPEAT_GAP_MS
      ) {
        j++
      }
    }
    if (j === i) {
      out.push(head)
      i++
      continue
    }
    const run = rows.slice(i, j + 1)
    const newest = run[0].item
    const oldest = run[run.length - 1].item
    const text = head.key === 'profile_updated' ? 'Updated their profile' : newest.text
    out.push({
      key: head.key,
      group: head.group,
      item: {
        ...newest,
        text,
        count: run.reduce((n, r) => n + r.item.count, 0),
        range: timeRange(oldest.at, newest.at),
        children: run.map((r) => ({ id: r.item.id, text: r.item.text, at: r.item.at, who: r.item.who })),
      },
    })
    i = j + 1
  }
  return out
}

/**
 * The whole timeline for one tab, newest first, grouped. Its LENGTH is the
 * count the page shows in the header and at the end of the list.
 */
export function buildTimeline(
  src: { logs: LogRow[]; audits: AuditRow[]; sessions: SessionRow[] },
  group: TimelineGroup,
): TimelineItem[] {
  const logs = collapseTimeline(dedupeAgainstAudit(src.logs, src.audits))
  const flat: Flat[] = []
  for (const l of logs) {
    const text = timelineSentence(l.event, l.meta)
    flat.push({
      group: groupOfEvent(l.event),
      key: repeatKey(l.event, text),
      item: { id: `l:${l.id}`, at: l.at, text, who: null, tone: toneOf(l.event), count: l.meta?._group ? Number(l.meta.times) || 1 : 1, range: null, children: null, sessionId: null },
    })
  }
  for (const a of src.audits) {
    const text = auditSentence(a.action, a.detail)
    flat.push({
      group: 'moderation',
      key: `audit|${a.action}|${text}|${a.actorName ?? ''}`,
      item: { id: `a:${a.id}`, at: a.at, text, who: a.actorName ? `by ${a.actorName}` : 'by the system', tone: toneOf(a.action), count: 1, range: null, children: null, sessionId: null },
    })
  }
  for (const s of src.sessions) {
    flat.push({
      group: 'activity',
      key: null,
      item: { id: `s:${s.id}`, at: s.startedAt, text: sessionSentence(s), who: null, tone: 'grey', count: 1, range: null, children: null, sessionId: s.id },
    })
  }
  flat.sort((x, y) => Date.parse(y.item.at) - Date.parse(x.item.at) || (x.item.id < y.item.id ? 1 : -1))
  const picked = group === 'all' ? flat : flat.filter((f) => f.group === group)
  return groupRepeats(picked).map((f) => f.item)
}

/** "2 sessions · 6 min in the last 30 days · last seen 19 Oct 2026". */
export function activitySummaryLine(s: { sessions30: number; timeMs30: number; lastSeen: string | null }): string {
  const sec = Math.round((s.timeMs30 || 0) / 1000)
  const dur = sec < 60 ? `${sec} sec` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`
  const base = `${s.sessions30} session${s.sessions30 === 1 ? '' : 's'} · ${dur} in the last 30 days`
  return s.lastSeen ? `${base} · last seen ${formatDate(s.lastSeen)}` : `${base} · not seen yet`
}
