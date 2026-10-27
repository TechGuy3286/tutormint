// lib/tuitionConsentCore.ts
//
// PURE, client-safe. Parent consent for listings (owner, 27 Oct 2026).
//
// Every tuition carries ONE consent record (tuition_consents, migration 208):
//   status  Recorded | Not recorded
//   method  Phone call | WhatsApp | In person | Parent posted it themselves
// A tuition a parent posts from their own account is "Recorded — Parent posted
// it themselves". A staff post needs the "Parent agreed to be listed on
// TutorMint" tick and a method before it saves (create AND edit).
//
// The Owner's switch "Hide parent numbers when consent isn't recorded" (ON by
// default): for a tuition whose consent is Not recorded, the parent's number is
// never revealed to a tutor — not by "View number", not on the page for a tutor
// who revealed it earlier — and no reveal is counted. Tutors still apply; staff
// forward their profile through Applications.

export type ConsentStatus = 'recorded' | 'not_recorded'
export type ConsentMethod = 'phone' | 'whatsapp' | 'in_person' | 'parent_posted'

export type ConsentRecord = {
  status: ConsentStatus
  method: ConsentMethod | null
  recordedByName: string | null
  recordedAt: string | null
  note: string | null
}

export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  in_person: 'In person',
  parent_posted: 'Parent posted it themselves',
}

/** The methods staff choose from ("Parent posted it themselves" is set by the
 *  system for a parent's own post, never picked by staff). */
export const STAFF_CONSENT_METHODS = ['phone', 'whatsapp', 'in_person'] as const satisfies readonly ConsentMethod[]
export type StaffConsentMethod = (typeof STAFF_CONSENT_METHODS)[number]

export function isStaffConsentMethod(v: unknown): v is StaffConsentMethod {
  return typeof v === 'string' && (STAFF_CONSENT_METHODS as readonly string[]).includes(v)
}

/** The tick box on staff Post a tuition and admin edit. */
export const CONSENT_TICK_LABEL = 'Parent agreed to be listed on TutorMint'
export const CONSENT_REQUIRED_ERROR = 'Tick “Parent agreed to be listed on TutorMint” and choose how they agreed before saving.'
export const CONSENT_METHOD_ERROR = 'Choose how the parent agreed: phone call, WhatsApp or in person.'

/** Why a staff consent input cannot be saved, or null. */
export function consentInputProblem(input: { agreed?: boolean | null; method?: string | null }): string | null {
  if (!input.agreed) return CONSENT_REQUIRED_ERROR
  if (!isStaffConsentMethod(input.method)) return CONSENT_METHOD_ERROR
  return null
}

/** A note, trimmed and capped (the column allows 500). */
export function cleanConsentNote(note: string | null | undefined): string | null {
  const t = (note ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 500) : null
}

/** "Recorded — Phone call" / "Not recorded". */
export function consentLabel(r: Pick<ConsentRecord, 'status' | 'method'> | null | undefined): string {
  if (!r || r.status !== 'recorded' || !r.method) return 'Not recorded'
  return `Recorded — ${CONSENT_METHOD_LABEL[r.method]}`
}

export const CONSENT_NOT_RECORDED_CHIP = 'Consent not recorded'

/** A missing row reads as Not recorded (a staff post before migration 208). */
export function isRecorded(r: Pick<ConsentRecord, 'status'> | null | undefined): boolean {
  return r?.status === 'recorded'
}

// ── the Owner's switch ────────────────────────────────────────────────────

export const HIDE_NUMBERS_SETTING = 'privacy.hide_unconsented_numbers'
export const HIDE_NUMBERS_LABEL = 'Hide parent numbers when consent isn’t recorded'

/** The stored value → on/off. ON unless it says off (the default is ON, and an
 *  unreadable or missing value must never expose numbers). */
export function parseHideSwitch(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return !(v === 'false' || v === 'off' || v === '0' || v === 'no')
}

/** Is this tuition's parent number hidden from tutors? */
export function numberHidden(switchOn: boolean, consent: Pick<ConsentRecord, 'status'> | null | undefined): boolean {
  return switchOn && !isRecorded(consent)
}

/** What a tutor sees in place of the number / the reveal button. */
export const HIDDEN_CONTACT_LINE = 'Apply — our team will share your profile with the parent'

/** The refusal a direct reveal request gets (no reveal is counted). */
export const HIDDEN_REVEAL_ERROR =
  'The parent’s number is not shared for this tuition. Apply — our team will share your profile with the parent.'

// ── "Ask parent" ──────────────────────────────────────────────────────────

export const CONSENT_ASK_KEY = 'consent_ask'
export const CONSENT_ASK_DEFAULT =
  "Assalam o Alaikum, we'd like to list your tuition requirement on TutorMint so verified tutors can apply. May we list it? Please reply YES or NO."
/** Optional placeholders the template may use (the default uses none). */
export const CONSENT_ASK_PLACEHOLDERS = ['parent_name', 'tuition_title', 'tm_number'] as const

/** Fill the Ask parent template. An empty value is removed cleanly. */
export function fillConsentAsk(
  body: string,
  v: { parentName?: string | null; tuitionTitle?: string | null; tmNumber?: string | null },
): string {
  const base = body.trim() ? body : CONSENT_ASK_DEFAULT
  const clean = (s: string | null | undefined) => (s ?? '').replace(/[0-9]{7,}/g, '').replace(/\S+@\S+/g, '').trim()
  return base
    .replace(/\{parent_name\}/g, clean(v.parentName))
    .replace(/\{tuition_title\}/g, clean(v.tuitionTitle))
    .replace(/\{tm_number\}/g, clean(v.tmNumber))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.?!])/g, '$1')
    .trim()
}

// ── bulk import ───────────────────────────────────────────────────────────

/** The consent column of a tuition import row. "yes"/"phone"/"whatsapp"/
 *  "in person" (any case) = Recorded with that method ("yes" = phone call);
 *  anything else, or no column = Not recorded. A row is never refused for it. */
export function consentFromImportCell(cell: string | null | undefined): { status: ConsentStatus; method: StaffConsentMethod | null } {
  const v = (cell ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  if (!v) return { status: 'not_recorded', method: null }
  if (v === 'whatsapp' || v === 'wa') return { status: 'recorded', method: 'whatsapp' }
  if (v === 'in person' || v === 'inperson' || v === 'met') return { status: 'recorded', method: 'in_person' }
  if (v === 'phone' || v === 'phone call' || v === 'call' || v === 'yes' || v === 'y' || v === 'agreed') return { status: 'recorded', method: 'phone' }
  return { status: 'not_recorded', method: null }
}

/** The import's column names that carry consent (case-insensitive). */
export const IMPORT_CONSENT_COLUMNS = ['consent', 'parent consent', 'parent agreed'] as const

export function importRowConsent(row: Record<string, string | null | undefined>): { status: ConsentStatus; method: StaffConsentMethod | null } {
  for (const [k, v] of Object.entries(row)) {
    if ((IMPORT_CONSENT_COLUMNS as readonly string[]).includes(k.trim().toLowerCase())) return consentFromImportCell(v)
  }
  return { status: 'not_recorded', method: null }
}

// ── Team activity "Consent recorded" column ──────────────────────────────

export type ConsentTally = { recorded: number; total: number }

/** "75% (3 of 4)", or "—" when the staff member posted nothing in the window. */
export function consentPercentLabel(t: ConsentTally | null | undefined): string {
  if (!t || t.total === 0) return '—'
  return `${Math.round((t.recorded / t.total) * 100)}% (${t.recorded} of ${t.total})`
}

export function addTally(a: ConsentTally, b: ConsentTally): ConsentTally {
  return { recorded: a.recorded + b.recorded, total: a.total + b.total }
}
