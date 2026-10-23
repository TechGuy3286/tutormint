// lib/journeyCore.ts
//
// PURE, client-safe. The Activity tab on a member's admin page (owner, 23 Oct
// 2026): ONE timeline, newest first, of everything that has happened to a
// tutor (or, on a parent, to that parent), each line with its time and who did
// it.
//
// Every line is built from a record that already exists (payments, documents,
// applications, forwards, stage changes, follow-ups, notes, the audit log, the
// member's own event log) — nothing is stored twice. A line whose record was
// made before the Activity tab went live (JOURNEY_LIVE_AT) is marked "from
// records": it was rebuilt from the records, not written while the tab
// existed.
//
// PRIVACY: a line never carries a phone number, a CNIC number or an email. The
// builders here only use names, plan names, TM numbers and stage words; a
// staff note is checked when it is written (noteProblem) and scrubbed again
// when it is shown (scrubPii).
//
// Unit-tested by scripts/test-tutor-journey.ts.

export const JOURNEY_LIVE_AT = '2026-10-23T12:00:00.000Z'

export type JourneyKind =
  | 'signed_up'
  | 'step'
  | 'follow_up'
  | 'call'
  | 'payment_started'
  | 'paid'
  | 'payment_failed'
  | 'refunded'
  | 'doc_submitted'
  | 'doc_approved'
  | 'doc_rejected'
  | 'applied'
  | 'withdrawn'
  | 'forwarded'
  | 'stage'
  | 'check_in'
  | 'parent_follow_up'
  | 'hired'
  | 'account_type'
  | 'pause'
  | 'note'
  | 'tuition_posted'
  | 'moderation'

export const JOURNEY_KIND_LABEL: Record<JourneyKind, string> = {
  signed_up: 'Signed up',
  step: 'Profile step',
  follow_up: 'Follow-up sent',
  call: 'Call logged',
  payment_started: 'Payment started',
  paid: 'Paid',
  payment_failed: 'Payment failed',
  refunded: 'Refunded',
  doc_submitted: 'Document submitted',
  doc_approved: 'Document approved',
  doc_rejected: 'Document rejected',
  applied: 'Application',
  withdrawn: 'Application withdrawn',
  forwarded: 'Forwarded to the parent',
  stage: 'Stage change',
  check_in: 'Tutor check-in',
  parent_follow_up: 'Parent follow-up',
  hired: 'Hired',
  account_type: 'Account type change',
  pause: 'Pause',
  note: 'Note',
  tuition_posted: 'Tuition posted',
  moderation: 'Staff action',
}

export type JourneyLine = {
  /** Stable and unique: "<source>:<row id>". */
  id: string
  at: string
  kind: JourneyKind
  text: string
  /** Who did it — a staff member's name, "Parent", "The tutor", or null. */
  by: string | null
  fromRecords: boolean
  /** A note: its id, so it can be withdrawn, and its state. */
  noteId?: string
  withdrawn?: { at: string; by: string | null; reason: string } | null
}

export type RawLine = Omit<JourneyLine, 'fromRecords'>

const ms = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : NaN
}

/** Newest first; equal times by id so the order never wobbles. Lines with no
 *  usable time are dropped. Every line's text is scrubbed of contact details. */
export function buildJourney(lines: RawLine[], liveAt: string = JOURNEY_LIVE_AT): JourneyLine[] {
  const live = ms(liveAt)
  const seen = new Set<string>()
  const out: JourneyLine[] = []
  for (const l of lines) {
    if (!Number.isFinite(ms(l.at)) || seen.has(l.id)) continue
    seen.add(l.id)
    out.push({ ...l, text: scrubPii(l.text), fromRecords: ms(l.at) < live })
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** Count lines per kind (the report's "backfill counts"). */
export function countByKind(lines: JourneyLine[], onlyFromRecords = true): Partial<Record<JourneyKind, number>> {
  const out: Partial<Record<JourneyKind, number>> = {}
  for (const l of lines) if (!onlyFromRecords || l.fromRecords) out[l.kind] = (out[l.kind] ?? 0) + 1
  return out
}

// ------------------------------------------------------------- contact details

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// A CNIC (5-7-1 digits, with or without dashes) or a phone-like run: 10+
// digits, allowing spaces, dashes, dots and a leading +.
const CNIC = /\b\d{5}[-\s]?\d{7}[-\s]?\d\b/g
const PHONE = /\+?\d[\d\s.-]{8,}\d/g

/** Does this text carry a phone number, a CNIC number or an email? */
export function hasPii(text: string): boolean {
  if (new RegExp(EMAIL.source).test(text)) return true
  if (new RegExp(CNIC.source).test(text)) return true
  for (const m of text.match(new RegExp(PHONE.source, 'g')) ?? []) if (m.replace(/\D/g, '').length >= 10) return true
  return false
}

/** The text with any contact detail replaced by "[hidden]". */
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL, '[hidden]')
    .replace(CNIC, '[hidden]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[hidden]' : m))
}

// ---------------------------------------------------------------------- notes

export const NOTE_KINDS = ['call', 'whatsapp', 'note'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp outside the system',
  note: 'Note',
}
export const NOTE_MAX = 1000

export function noteProblem(body: string): string | null {
  const t = body.trim()
  if (!t) return 'Write the note.'
  if (t.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`
  if (hasPii(t)) return 'Please do not write phone numbers, CNIC numbers or emails in a note.'
  return null
}

export function withdrawProblem(reason: string): string | null {
  const t = reason.trim()
  if (!t) return 'Say why the note is withdrawn.'
  if (t.length > 500) return 'Keep the reason under 500 characters.'
  if (hasPii(t)) return 'Please do not write phone numbers, CNIC numbers or emails here.'
  return null
}

export function noteText(kind: NoteKind, body: string): string {
  return `${NOTE_KIND_LABEL[kind]}: ${body.trim()}`
}

// -------------------------------------------------------------- summary strip

export type AppFact = { jobId: string; stage: string; createdAt: string; jobCreatedAt?: string | null; stageChangedAt?: string | null }

export type JourneyCounts = { applications: number; forwarded: number; waitingToForward: number; hired: number }

/** The stages that mean "shared with the parent" (lib/applicationStageCore SHARED_STAGES). */
const SHARED = new Set(['forwarded', 'contacted', 'demo', 'hired', 'no_response'])

/** Applications · Forwarded · Waiting to forward · Hired. An application in a
 *  live forward counts as forwarded even if its stage was never moved. */
export function journeyCounts(apps: AppFact[], forwardedJobIds: Set<string>): JourneyCounts {
  let forwarded = 0
  let waiting = 0
  let hired = 0
  for (const a of apps) {
    const fwd = SHARED.has(a.stage) || (a.stage === 'applied' && forwardedJobIds.has(a.jobId))
    if (fwd) forwarded++
    else if (a.stage === 'applied') waiting++
    if (a.stage === 'hired') hired++
  }
  return { applications: apps.length, forwarded, waitingToForward: waiting, hired }
}

/** The newest contact time of any kind. */
export function latestAt(times: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const t of times) if (t && Number.isFinite(ms(t)) && (!best || ms(t) > ms(best))) best = t
  return best
}

// ------------------------------------------------------------- line builders

export const DOC_NAME: Record<string, string> = { cnic: 'CNIC', selfie: 'Selfie', degree: 'Degree certificate', photo: 'Profile photo' }

export function docName(kind: string): string {
  return DOC_NAME[kind] ?? kind.replace(/_/g, ' ')
}

export function tm(ref: string | null | undefined): string {
  return ref ? ref : 'a tuition'
}

const STAGE_WORD: Record<string, string> = {
  applied: 'Applied',
  forwarded: 'Forwarded',
  contacted: 'Contacted',
  demo: 'Demo/interview',
  hired: 'Hired',
  not_selected: 'Not selected',
  no_response: 'No response',
}

export function stageWord(s: string | null | undefined): string {
  return (s && STAGE_WORD[s]) || (s ?? '').replace(/_/g, ' ')
}
