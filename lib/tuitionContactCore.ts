// lib/tuitionContactCore.ts
//
// A tuition must always have the parent's contact number (owner, 12 Oct 2026) —
// the PURE half. Without a number a tutor's "View number" shows nothing (and
// still uses an application) and staff cannot forward applicants.
//
//   • A STAFF-posted tuition carries the number in job_contacts: the "Parent
//     contact number" is REQUIRED on Post a tuition and Edit tuition.
//   • A PARENT-posted tuition uses the parent's own verified mobile, always.
//   • A live tuition with no valid number is PAUSED with the reason "No contact
//     number" (pause_source 'no_contact'). Nothing is deleted. Resuming it asks
//     for the number first, then gives a fresh 20 days on the same address.
//
// One number format is stored everywhere: the MSISDN of lib/phone.ts
// (923001234567). No I/O here (scripts/test-tuition-contact.ts).

import { normalisePkMobile } from './phone'

/** jobs.pause_source for a tuition paused because it has no contact number. */
export const NO_CONTACT_SOURCE = 'no_contact'
/** The reason shown to staff. */
export const NO_CONTACT_REASON = 'No contact number'
/** The actor named on the clean-up's audit entries. */
export const NO_CONTACT_ACTOR = 'system: missing contact'

/** What staff see when the number is missing or not a Pakistani mobile. */
export const CONTACT_NUMBER_MESSAGE = "Enter the parent's mobile number, e.g. 0300 1234567."

/**
 * The required "Parent contact number": any common Pakistani mobile format
 * (03XX XXXXXXX, 03XX-XXXXXXX, +92 3XX…, 923XX…, 00923XX…) → the stored MSISDN.
 * Anything else — empty, a landline, a foreign number, letters — is refused.
 */
export function parseContactNumber(raw: string | null | undefined): { ok: true; msisdn: string } | { ok: false; error: string } {
  const msisdn = normalisePkMobile(raw)
  return msisdn ? { ok: true, msisdn } : { ok: false, error: CONTACT_NUMBER_MESSAGE }
}

export type TuitionContactFacts = {
  /** Posted by the TutorMint team account (staff-posted). */
  isTeam: boolean
  /** job_contacts.contact_phone / contact_whatsapp (staff-posted). */
  contactPhone?: string | null
  contactWhatsapp?: string | null
  /** The posting parent's own mobile and when it was verified (parent-posted). */
  parentPhone?: string | null
  parentPhoneVerifiedAt?: string | null
}

/**
 * The tuition's contact number as an MSISDN, or null when it has none.
 * Staff-posted: the number entered for the tuition (the phone, else the
 * WhatsApp). Parent-posted: the parent's own VERIFIED mobile.
 */
export function tuitionContactNumber(f: TuitionContactFacts): string | null {
  if (f.isTeam) return normalisePkMobile(f.contactPhone) ?? normalisePkMobile(f.contactWhatsapp)
  return f.parentPhoneVerifiedAt ? normalisePkMobile(f.parentPhone) : null
}

export type CleanupJob = TuitionContactFacts & { id: string; status: string }

/**
 * The one-time clean-up: which tuitions to pause. Only LIVE ones (status
 * 'open') with no valid contact number. A tuition already paused, closed or
 * hired is left alone — so a second run pauses nothing.
 */
export function tuitionsToPause<T extends CleanupJob>(jobs: T[]): T[] {
  return jobs.filter((j) => j.status === 'open' && tuitionContactNumber(j) === null)
}

/** Why a resume is refused, or null when it may go ahead. A tuition with no
 *  contact number cannot go live — whatever paused it. */
export function resumeContactProblem(f: TuitionContactFacts): string | null {
  return tuitionContactNumber(f) === null ? `Add the parent's mobile number first. ${CONTACT_NUMBER_MESSAGE}` : null
}

/** A row of a bulk list of tuitions (any import or script). */
export type ImportTuitionRow = { row: number; contactPhone?: string | null }

/** Split rows into those with a valid number and those skipped, naming each skipped row. */
export function splitByContactNumber<T extends ImportTuitionRow>(rows: T[]): { ok: (T & { msisdn: string })[]; skipped: { row: number; reason: string }[] } {
  const ok: (T & { msisdn: string })[] = []
  const skipped: { row: number; reason: string }[] = []
  for (const r of rows) {
    const p = parseContactNumber(r.contactPhone)
    if (p.ok) ok.push({ ...r, msisdn: p.msisdn })
    else skipped.push({ row: r.row, reason: p.error })
  }
  return { ok, skipped }
}
