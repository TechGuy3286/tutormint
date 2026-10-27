// lib/contactWithdrawCore.ts — PURE rules for "Withdraw a contact" and the
// "Do not use" list (owner, 27 Oct 2026). I/O in lib/contactWithdraw.ts.
//
// A person whose phone number was put on tuitions without their consent asks
// for it to be removed (CLAUDE.md rule 14: personal data removed at a person's
// request is the one thing that is deleted). The Owner types the number; every
// tuition that uses it is closed (status 'hidden', hidden_reason
// 'contact_withdrawn' — the hidden-tuition machinery of migration 198 gives the
// 301, the noindex, no JobPosting, no list or sitemap entry, and "Tuition no
// longer available" on its applications), the number is removed from the
// tuitions' contact data and text, and it goes on the Do not use list.
//
// THE NUMBER IS NEVER STORED OR LOGGED IN THE CLEAR. The list keeps a sha256
// hash (numberHash) and a masked form for the Owner (0300 •••• 123). Audit rows
// carry ids and counts, never digits (auditDetailSafe checks it).

import { createHash } from 'node:crypto'

import { findPhoneSpans } from '@/lib/masking'
import { normalisePkMobile } from '@/lib/phone'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'

/** jobs.hidden_reason of a withdrawn tuition. */
export const WITHDRAWN_REASON = 'contact_withdrawn'
/** What staff see for a withdrawn tuition. */
export const WITHDRAWN_LABEL = 'Closed: contact withdrawn'
/** What replaces the number in a tuition's text. */
export const NUMBER_REMOVED = '[number removed]'

/** The ONE refusal every posting path gives for a listed number. */
export const DO_NOT_USE_MESSAGE = "This number has asked not to be contacted. Please don't use it."

/** The canonical MSISDN (923001234567) for any common way of typing a
 *  Pakistani mobile: 03xx…, +92…, 92…, 0092…, with spaces or dashes. */
export function parseWithdrawNumber(raw: string | null | undefined): string | null {
  return normalisePkMobile(raw ?? null)
}

/** The stored hash of a number. Unsalted sha256 under a fixed prefix, the same
 *  approach as the signup blocklist's CNIC hash: robust to key rotation, and
 *  the table is service-role only. */
export function numberHash(msisdn: string): string {
  return createHash('sha256').update(`tm-do-not-use:${msisdn}`).digest('hex')
}

/** 0300 •••• 123 — the only way a number is ever shown on this tool. */
export function maskNumber(msisdn: string): string {
  return maskPhoneDisplay(msisdn) ?? '•••'
}

/** Two stored values are the same mobile (whatever their format). */
export function sameNumber(a: string | null | undefined, msisdn: string): boolean {
  return !!a && normalisePkMobile(a) === msisdn
}

/** Every mobile written inside a piece of text, as MSISDNs. */
export function numbersInText(text: string | null | undefined): string[] {
  const t = text ?? ''
  const out: string[] = []
  for (const s of findPhoneSpans(t)) {
    const m = normalisePkMobile(t.slice(s.start, s.end))
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

export function textHasNumber(text: string | null | undefined, msisdn: string): boolean {
  return numbersInText(text).includes(msisdn)
}

/** The text with every occurrence of this number replaced by NUMBER_REMOVED.
 *  Other numbers are left as they are. */
export function scrubNumber(text: string | null | undefined, msisdn: string): string | null {
  if (text == null) return null
  const spans = findPhoneSpans(text).filter((s) => normalisePkMobile(text.slice(s.start, s.end)) === msisdn)
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.start) + NUMBER_REMOVED
    at = s.end
  }
  return out + text.slice(at)
}

/** A withdrawal or a list removal needs a written reason. */
export function reasonProblem(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim()
  if (r.length < 3) return 'Give a reason (for example: Person says they never posted; asked for removal).'
  if (r.length > 600) return 'Keep the reason under 600 characters.'
  if (/\d{7,}/.test(r.replace(/[\s-]/g, ''))) return 'Leave the phone number out of the reason.'
  return null
}

/** Is any of these numbers on the list (given the live hashes)? */
export function listedNumber(numbers: (string | null | undefined)[], liveHashes: Set<string>): boolean {
  for (const n of numbers) {
    const m = normalisePkMobile(n ?? null)
    if (m && liveHashes.has(numberHash(m))) return true
  }
  return false
}

/** Every number a tuition carries: the contact fields and anything written in
 *  its title or description. */
export function tuitionNumbers(input: {
  contactPhone?: string | null
  contactWhatsapp?: string | null
  ownNumber?: string | null
  title?: string | null
  description?: string | null
  social?: string | null
}): string[] {
  const out = new Set<string>()
  for (const v of [input.contactPhone, input.contactWhatsapp, input.ownNumber]) {
    const m = normalisePkMobile(v ?? null)
    if (m) out.add(m)
  }
  for (const t of [input.title, input.description, input.social]) for (const m of numbersInText(t)) out.add(m)
  return [...out]
}

/** No run of 7+ digits anywhere in an audit / log detail (a number, even
 *  partly masked, never goes there). */
export function auditDetailSafe(detail: unknown): boolean {
  return !/\d{7,}/.test(JSON.stringify(detail ?? null).replace(/[\s-]/g, ''))
}

// ---------------------------------------------------------------------------
// The consent report (item 6): staff-posted tuitions with a parent number that
// belongs to no account, counted per staff member.

export type ConsentRow = { postedBy: string | null; number: string | null }

export function consentCounts(
  rows: ConsentRow[],
  accountNumbers: Set<string>,
  staffName: (id: string) => string,
): { staff: string; count: number }[] {
  const by = new Map<string, number>()
  for (const r of rows) {
    const m = normalisePkMobile(r.number ?? null)
    if (!m || accountNumbers.has(m)) continue
    const who = r.postedBy ? staffName(r.postedBy) : 'Unknown poster'
    by.set(who, (by.get(who) ?? 0) + 1)
  }
  return [...by.entries()].map(([staff, count]) => ({ staff, count })).sort((a, b) => b.count - a.count || a.staff.localeCompare(b.staff))
}

// ---------------------------------------------------------------------------
// The row changes a withdrawal makes (pure, so the tests see exactly them).

/** The jobs update that closes one tuition: hidden with reason
 *  'contact_withdrawn' (301, noindex, no JobPosting, out of every list), its
 *  earlier status kept, the number taken out of its title and description. */
export function closeUpdate(
  job: { status: string | null; title: string | null; description: string | null },
  msisdn: string,
  nowIso: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    title: scrubNumber(job.title, msisdn),
    description: scrubNumber(job.description, msisdn),
    status: 'hidden',
    hidden_reason: WITHDRAWN_REASON,
    is_featured: false,
  }
  if (job.status !== 'hidden') {
    update.hidden_prev_status = job.status ?? 'open'
    update.hidden_at = nowIso
  }
  return update
}

// ---------------------------------------------------------------------------
// Pause on complaint (owner, 27 Oct 2026) — the reversible default. Every
// tuition whose own contact data holds the number becomes status 'hidden',
// hidden_reason 'contact_complaint' ("Paused: contact complaint"): out of every
// list, search, the sitemap and Google Jobs; noindex; the page stays at its URL
// and says "This tuition is not available"; the number is never revealed; its
// applications read "Tuition no longer available". While the number is on
// hold, a new tuition using it is refused. "Unpause all" puts every tuition back
// exactly as it was and lifts the hold.

export const COMPLAINT_REASON = 'contact_complaint'
export const COMPLAINT_LABEL = 'Paused: contact complaint'
export const HOLD_MESSAGE = 'This number has a complaint on file. Please check with the owner.'
export const NOT_AVAILABLE_MESSAGE = 'This tuition is not available'

export type HoldSnapshot = {
  prev_status: string | null
  prev_hidden_reason: string | null
  prev_hidden_prev_status: string | null
  prev_hidden_at: string | null
  prev_is_featured: boolean | null
}

type JobState = {
  status: string | null
  hidden_reason: string | null
  hidden_prev_status: string | null
  hidden_at: string | null
  is_featured: boolean | null
}

/** Is this tuition already paused on complaint or withdrawn? Then a pause
 *  leaves it alone. */
export function pauseSkips(job: Pick<JobState, 'status' | 'hidden_reason'>): boolean {
  return job.status === 'hidden' && (job.hidden_reason === COMPLAINT_REASON || job.hidden_reason === WITHDRAWN_REASON)
}

/** What "Unpause all" must put back, exactly. */
export function holdSnapshot(job: JobState): HoldSnapshot {
  return {
    prev_status: job.status,
    prev_hidden_reason: job.hidden_reason,
    prev_hidden_prev_status: job.hidden_prev_status,
    prev_hidden_at: job.hidden_at,
    prev_is_featured: job.is_featured,
  }
}

/** The jobs update that pauses one tuition on complaint. Its text is NOT
 *  changed (nothing is removed — the page shows none of it while paused). */
export function pauseUpdate(job: JobState, nowIso: string): Record<string, unknown> {
  const update: Record<string, unknown> = { status: 'hidden', hidden_reason: COMPLAINT_REASON, is_featured: false }
  if (job.status !== 'hidden') {
    update.hidden_prev_status = job.status ?? 'open'
    update.hidden_at = nowIso
  }
  return update
}

/** The jobs update that "Unpause all" writes: the snapshot, exactly. */
export function restoreUpdate(s: HoldSnapshot): Record<string, unknown> {
  return {
    status: s.prev_status ?? 'open',
    hidden_reason: s.prev_hidden_reason,
    hidden_prev_status: s.prev_hidden_prev_status,
    hidden_at: s.prev_hidden_at,
    is_featured: s.prev_is_featured ?? false,
  }
}

/** Only a tuition still paused by this complaint is restored (one withdrawn
 *  since stays withdrawn). */
export function mayRestore(job: Pick<JobState, 'status' | 'hidden_reason'>): boolean {
  return job.status === 'hidden' && job.hidden_reason === COMPLAINT_REASON
}

/** A tuition paused on complaint (the page shows the not-available notice). */
export function isComplaintPaused(job: { status?: string | null; hidden_reason?: string | null }): boolean {
  return job.status === 'hidden' && job.hidden_reason === COMPLAINT_REASON
}

/** The refusal for a set of numbers given the live Do-not-use and hold hashes:
 *  Do not use wins (it is permanent), then the hold. */
export function postingRefusal(numbers: (string | null | undefined)[], doNotUse: Set<string>, holds: Set<string>): string | null {
  if (listedNumber(numbers, doNotUse)) return DO_NOT_USE_MESSAGE
  if (listedNumber(numbers, holds)) return HOLD_MESSAGE
  return null
}

/** The job_contacts update that removes the number (null when nothing holds it). */
export function contactUpdate(
  c: { contact_phone: string | null; contact_whatsapp: string | null; contact_social: string | null; contact_address: string | null },
  msisdn: string,
): Record<string, unknown> | null {
  const update: Record<string, unknown> = {}
  if (sameNumber(c.contact_phone, msisdn)) update.contact_phone = null
  if (sameNumber(c.contact_whatsapp, msisdn)) update.contact_whatsapp = null
  const social = scrubNumber(c.contact_social, msisdn)
  if (social !== c.contact_social) update.contact_social = social
  const address = scrubNumber(c.contact_address, msisdn)
  if (address !== c.contact_address) update.contact_address = address
  return Object.keys(update).length > 0 ? update : null
}
