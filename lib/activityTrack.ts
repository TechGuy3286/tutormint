// lib/activityTrack.ts
//
// Pure helpers for member activity telemetry (PR99 §2): mask a search term,
// detect a bot, and validate/normalise the batch the client sends. No DB, no
// server-only — so the ingest route, the client and the tests all share one set
// of rules. The ingest route (/api/activity) is the only writer.

/**
 * Mask any phone number or email address inside a free-text search term before
 * it is stored. A member who pastes a number into the search box must not have
 * it recorded in the clear. Everything else is kept so "physics lahore" is
 * searchable in the admin's top-terms view.
 */
export function maskSearchTerm(raw: string): string {
  let s = String(raw ?? '').slice(0, 120)
  // Emails first (before digit masking eats the number in an address).
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  // Any run of 7+ digits (optionally with +, -, spaces) — covers 03xx-xxxxxxx,
  // +92..., and bare 11-digit mobiles — is masked. A tuition reference like
  // TM-1450 has only 4 digits and survives.
  s = s.replace(/(?:\+?\d[\d\s-]{6,}\d)/g, '[number]')
  return s.trim()
}

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|node-fetch|monitor|uptime|pingdom|lighthouse/i

/** True for an obvious non-human user agent. Telemetry from these is dropped so
 *  the numbers reflect people, not crawlers. Conservative: a missing UA is
 *  treated as a bot (a real browser always sends one). */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length < 8) return true
  return BOT_RE.test(ua)
}

// The only event kinds the ingest accepts. A kind not on this list is dropped,
// so the client can never write an arbitrary category.
export const EVENT_KINDS = ['page_view', 'search', 'action'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

// The only ACTION labels accepted (the key actions from the spec). Kept as a
// fixed set so no free-text action can be injected. Most of these also log to
// user_activity_log server-side; recording them here keeps them inside a
// session for the Activity view.
export const ACTION_KEYS = [
  'applied', 'viewed_contact', 'messaged', 'demo_requested', 'demo_accepted',
  'shortlisted', 'unshortlisted', 'profile_edited', 'payment_started',
  'payment_completed', 'plan_changed', 'logged_in', 'logged_out',
] as const

export type RawEvent = {
  kind?: unknown
  path?: unknown
  label?: unknown
  resultCount?: unknown
  meta?: unknown
}

export type CleanEvent = {
  kind: EventKind
  path: string | null
  label: string | null
  resultCount: number | null
  meta: Record<string, unknown>
}

const MAX_EVENTS = 40

/**
 * Validate + normalise a batch of events from the client. Drops unknown kinds,
 * clamps the count, masks a search label, and strips everything not whitelisted
 * — so no password, OTP, CNIC, message body or payment detail can ride in.
 */
export function cleanEvents(input: unknown): CleanEvent[] {
  if (!Array.isArray(input)) return []
  const out: CleanEvent[] = []
  for (const raw of input.slice(0, MAX_EVENTS) as RawEvent[]) {
    const kind = raw?.kind
    if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as EventKind)) continue
    const path = typeof raw.path === 'string' ? raw.path.slice(0, 200) : null
    let label = typeof raw.label === 'string' ? raw.label.slice(0, 200) : null
    // A search label is the typed term → mask it. Other labels are our own
    // plain-English strings, not member input.
    if (kind === 'search' && label) label = maskSearchTerm(label)
    const rc = Number(raw.resultCount)
    const resultCount = Number.isFinite(rc) && rc >= 0 ? Math.min(Math.floor(rc), 100000) : null
    // meta: only a small, known set of scalar keys (where typed, how many).
    const meta: Record<string, unknown> = {}
    if (raw.meta && typeof raw.meta === 'object') {
      for (const [k, val] of Object.entries(raw.meta as Record<string, unknown>)) {
        if (!/^[a-z_]{1,24}$/.test(k)) continue
        if (typeof val === 'string') meta[k] = val.slice(0, 80)
        else if (typeof val === 'number' && Number.isFinite(val)) meta[k] = val
        else if (typeof val === 'boolean') meta[k] = val
      }
    }
    // For an action, the label must be a whitelisted key (else drop the row).
    if (kind === 'action' && (!label || !ACTION_KEYS.includes(label as (typeof ACTION_KEYS)[number]))) continue
    out.push({ kind: kind as EventKind, path, label, resultCount, meta })
  }
  return out
}

/**
 * A plain-English description of a page, from its path (PR99 §2). Used for the
 * auto page-view label. Pages that know something richer (a tuition's TM number,
 * a tutor's name) push their own label via the tracker instead.
 */
export function pageLabel(pathname: string): string {
  const p = (pathname || '/').split('?')[0].replace(/\/+$/, '') || '/'
  const seg = p.split('/').filter(Boolean)
  if (p === '/') return 'Home page'
  if (p === '/browse/tutors') return 'Browsed tutors'
  if (p === '/browse/tuitions') return 'Browsed tuitions'
  if (p === '/membership-plans') return 'Viewed Membership Plans'
  if (seg[0] === 'tutors' && seg.length === 3) return `Viewed ${seg[2].replace(/-/g, ' ')} tutors in ${seg[1].replace(/-/g, ' ')}`
  if (seg[0] === 'tuitions' && seg.length === 3) return `Viewed ${seg[2].replace(/-/g, ' ')} tuitions in ${seg[1].replace(/-/g, ' ')}`
  if (seg[0] === 'tutor' && seg.length === 2 && seg[1] !== 'dashboard') return 'Viewed a tutor profile'
  if (seg[0] === 'tuitions' && seg.length === 2) return 'Viewed a tuition'
  if (p.startsWith('/tutor/dashboard')) return seg.length > 2 ? `Tutor dashboard — ${seg.slice(2).join(' / ')}` : 'Tutor dashboard'
  if (p.startsWith('/parent/dashboard')) return seg.length > 2 ? `Parent dashboard — ${seg.slice(2).join(' / ')}` : 'Parent dashboard'
  if (p === '/tutor/onboarding') return 'Tutor onboarding'
  if (p === '/tutor/complete-profile') return 'Completing tutor profile'
  if (p === '/parent/verify') return 'Parent verification'
  // A generic, readable fallback — never the raw path alone.
  return 'Viewed ' + (seg.join(' / ') || 'a page')
}

const ACTION_PHRASE: Record<string, string> = {
  applied: 'Applied to a tuition',
  viewed_contact: 'Viewed a contact number',
  messaged: 'Sent a message',
  demo_requested: 'Requested a demo',
  demo_accepted: 'Accepted a demo',
  shortlisted: 'Shortlisted a tutor',
  unshortlisted: 'Removed a shortlist',
  profile_edited: 'Edited their profile',
  payment_started: 'Started a payment',
  payment_completed: 'Completed a payment',
  plan_changed: 'Changed plan',
  logged_in: 'Signed in',
  logged_out: 'Signed out',
}

/** One plain-English line for an activity event, for the admin view (PR99 §2).
 *  Pure, so the admin page and the tests read the same wording. */
export function describeActivityEvent(ev: {
  kind: string
  label?: string | null
  resultCount?: number | null
}): string {
  if (ev.kind === 'search') {
    const n = ev.resultCount
    const tail = typeof n === 'number' ? ` — ${n} result${n === 1 ? '' : 's'}` : ''
    return `Searched “${ev.label ?? ''}”${tail}`
  }
  if (ev.kind === 'action') return ACTION_PHRASE[ev.label ?? ''] ?? (ev.label ?? 'Did something')
  // page_view and anything else: the label is already plain English.
  return ev.label ?? 'Viewed a page'
}

/** Clamp a client-reported active-time delta (ms) to something a 30s heartbeat
 *  could plausibly represent, so a tampered client cannot inflate time spent. */
export function clampActiveDelta(ms: unknown): number {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), 120000) // ≤ 2 min per beat
}

/** "14 min", "2 h 5 min", "45 sec" — plain English, never raw ms. Pure, so the
 *  server admin view and the client load-more both read the same wording. */
export function humanDuration(ms: number): string {
  const sec = Math.round((ms || 0) / 1000)
  if (sec < 60) return `${sec} sec`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
