// lib/mySignupsCore.ts
//
// PURE, client-safe. "My sign-ups" (owner, 16 Oct 2026): each staff member's
// own list of the people credited to their join link, their code, or an
// approved claim — plus their own claims that are not credited (yet).
//
//   • One row per person: name, FULL phone, email, city, Tutor or Parent, the
//     date they signed up, what credited them, the step they are at, the next
//     step in plain words, and Counted / Not counted with the reason.
//   • Steps. Tutors: Signed up → Mobile verified → Onboarded → Paid (the
//     Verification Fee approved). Parents: Signed up → Posted a tuition → Paid
//     (a plan approved). "Paid" is the paid rule of lib/staffTargetsCore —
//     the same rule Team activity counts, so the numbers match.
//   • A row NEVER carries a CNIC number, a document, a selfie, a receipt, bank
//     or payment details or an OTP code. "Paid" is only a date or null. The row
//     type below is the whole of what leaves the server (MY_SIGNUP_ROW_KEYS).
//   • A claim the staff member made that is not credited to them shows only
//     the name, a masked mobile and why it does not count: the account is not
//     theirs (yet), so nothing else about it is shown.
//
// The I/O half is lib/mySignups.ts; tests in scripts/test-my-signups.ts.

import { followUpText, followUpWaLink } from './followUpCore'
import type { MemberRole } from './staffSignupsCore'

export const MY_SIGNUPS_PATH = '/admin/my-signups'

export type CreditedBy = 'link' | 'code' | 'claim'

export const CREDITED_BY_LABEL: Record<CreditedBy, string> = {
  link: 'Join link',
  code: 'Staff code',
  claim: 'Approved claim',
}

export type MyStep = 'signed_up' | 'mobile_verified' | 'onboarded' | 'posted' | 'paid'

export const TUTOR_PATH: { key: MyStep; label: string }[] = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'mobile_verified', label: 'Mobile verified' },
  { key: 'onboarded', label: 'Onboarded' },
  { key: 'paid', label: 'Paid' },
]
export const PARENT_PATH: { key: MyStep; label: string }[] = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'posted', label: 'Posted a tuition' },
  { key: 'paid', label: 'Paid' },
]

export function pathFor(role: MemberRole): { key: MyStep; label: string }[] {
  return role === 'tutor' ? TUTOR_PATH : PARENT_PATH
}

export type NextStep =
  | 'verify_mobile'
  | 'finish_profile'
  | 'upload_documents'
  | 'pay_fee'
  | 'post_tuition'
  | 'buy_plan'
  | 'done'

export const NEXT_STEP_LABEL: Record<NextStep, string> = {
  verify_mobile: 'Verify mobile',
  finish_profile: 'Finish profile',
  upload_documents: 'Upload documents',
  pay_fee: 'Pay Verification Fee',
  post_tuition: 'Post a tuition',
  buy_plan: 'Buy a plan',
  done: 'Nothing — all done',
}

/** The template each next step sends, and the link it carries. Existing
 *  templates are reused where one fits (owner, 16 Oct 2026); the my_signup_*
 *  ones were added by migration 182. */
export const NEXT_STEP_TEMPLATE: Record<NextStep, { key: string; path: string }> = {
  verify_mobile: { key: 'signup_mobile_unverified', path: '/verify-phone' },
  finish_profile: { key: 'profile_completion_nudge', path: '/tutor/onboarding' },
  upload_documents: { key: 'my_signup_upload_documents', path: '/tutor/dashboard/settings#identity' },
  pay_fee: { key: 'my_signup_pay_fee', path: '/pay/choose?plan=verified' },
  post_tuition: { key: 'my_signup_post_tuition', path: '/parent/dashboard/post-job' },
  buy_plan: { key: 'my_signup_buy_plan', path: '/membership-plans' },
  done: { key: 'my_signup_check_in', path: '/support' },
}

/** The facts the step and "next step" are read from. */
export type MemberFacts = {
  role: MemberRole
  signedUpAt: string
  mobileVerifiedAt: string | null
  onboardedAt: string | null
  /** CNIC, profile photo and selfie are all on file (tutors). A yes/no only. */
  docsSubmitted: boolean
  postedAt: string | null
  /** The first qualifying payment's approval time (lib/staffTargetsCore). */
  paidAt: string | null
  /** A payment that would have counted was refunded. */
  refunded: boolean
}

/** The furthest step reached on the role's own path. */
export function stepOf(f: MemberFacts): MyStep {
  if (f.paidAt) return 'paid'
  if (f.role === 'tutor') return f.onboardedAt ? 'onboarded' : f.mobileVerifiedAt ? 'mobile_verified' : 'signed_up'
  return f.postedAt ? 'posted' : 'signed_up'
}

export function stepLabel(role: MemberRole, step: MyStep): string {
  return pathFor(role).find((s) => s.key === step)?.label ?? 'Signed up'
}

export function nextStepOf(f: MemberFacts): NextStep {
  if (f.role === 'tutor') {
    if (!f.mobileVerifiedAt) return 'verify_mobile'
    if (!f.onboardedAt) return 'finish_profile'
    if (!f.docsSubmitted) return 'upload_documents'
    if (!f.paidAt) return 'pay_fee'
    return 'done'
  }
  // A parent needs a verified mobile to post (lib/parentGate).
  if (!f.mobileVerifiedAt && !f.postedAt) return 'verify_mobile'
  if (!f.postedAt) return 'post_tuition'
  if (!f.paidAt) return 'buy_plan'
  return 'done'
}

export type NotCountedReason = 'not_paid' | 'refunded' | 'other_link' | 'outside_30' | 'claim_waiting' | 'claim_rejected'

export const NOT_COUNTED_LABEL: Record<NotCountedReason, string> = {
  not_paid: 'Not paid yet',
  refunded: 'Refunded',
  other_link: 'Credited to another link first',
  outside_30: 'Outside 30 days',
  claim_waiting: 'Claim waiting for Owner',
  claim_rejected: 'Claim rejected',
}

/** A credited person counts once paid and not refunded. */
export function countedReason(f: MemberFacts): NotCountedReason | null {
  if (f.paidAt) return null
  return f.refunded ? 'refunded' : 'not_paid'
}

/** Why a claim that is not credited to the claimant does not count. The stored
 *  reason is the words lib/staffSignupsCore REFUSAL_WORDS gave at the time. */
export function claimReason(status: 'pending' | 'rejected', reason: string | null | undefined): NotCountedReason {
  if (status === 'pending') return 'claim_waiting'
  const r = (reason ?? '').toLowerCase()
  if (r.includes('already credited')) return 'other_link'
  if (r.includes('last 30 days') || r.includes('outside 30')) return 'outside_30'
  return 'claim_rejected'
}

/** One row of the page — the WHOLE of what leaves the server for one person. */
export type MySignupRow = {
  /** The member's id (opens nothing on its own; the WhatsApp log names it). */
  memberId: string
  name: string
  /** Full mobile for a credited person; masked for a claim not credited. */
  phone: string | null
  /** The 92… number WhatsApp opens; null when there is none or the row is a claim. */
  waNumber: string | null
  email: string | null
  city: string | null
  role: MemberRole
  signedUpAt: string | null
  creditedBy: CreditedBy | null
  /** 'credit' = credited to this staff member; 'claim' = their claim, not credited. */
  kind: 'credit' | 'claim'
  step: MyStep | null
  stepLabel: string
  nextStep: NextStep | null
  nextStepLabel: string
  counted: boolean
  notCountedReason: NotCountedReason | null
  notCountedLabel: string | null
  /** Yes/No and the date — nothing else about money. */
  paid: boolean
  paidAt: string | null
  /** The staff member the person is credited to (for the shared lists). */
  staffId: string
  /** The ready-made WhatsApp link, or null. */
  waLink: string | null
}

/** The only keys a row may carry (scripts/test-my-signups.ts checks it). */
export const MY_SIGNUP_ROW_KEYS = [
  'memberId', 'name', 'phone', 'waNumber', 'email', 'city', 'role', 'signedUpAt', 'creditedBy', 'kind', 'step', 'stepLabel',
  'nextStep', 'nextStepLabel', 'counted', 'notCountedReason', 'notCountedLabel', 'paid', 'paidAt', 'staffId', 'waLink',
] as const

/** Never in a row, an API answer or the page (owner, 16 Oct 2026). */
export const FORBIDDEN_FIELD = /cnic|selfie|document|receipt|screenshot|iban|bank|account_number|otp|code_hash|amount|provider_ref|reference|card/i

/** A synthetic login address is not an email anybody reads. */
export function realEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  if (!e || e.endsWith('@users.tutormint.org')) return null
  return e
}

export function firstName(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}

/** The WhatsApp text for a next step, from its template body. */
export function whatsAppText(templateBody: string, name: string, link: string): string {
  return followUpText(templateBody, { name: firstName(name), step: null, link })
}

export function whatsAppLink(msisdn: string | null, text: string): string | null {
  return msisdn ? followUpWaLink(msisdn, text) : null
}

/** A credited person's row. `templateBodies` maps template key → body. */
export function creditRow(input: {
  memberId: string
  staffId: string
  name: string
  phone: string | null
  waNumber: string | null
  email: string | null
  city: string | null
  creditedBy: CreditedBy
  facts: MemberFacts
  templateBodies: Record<string, string>
  siteUrl: (path: string) => string
}): MySignupRow {
  const f = input.facts
  const step = stepOf(f)
  const next = nextStepOf(f)
  const reason = countedReason(f)
  const tpl = NEXT_STEP_TEMPLATE[next]
  const body = input.templateBodies[tpl.key]
  const text = body ? whatsAppText(body, input.name, input.siteUrl(tpl.path)) : null
  return {
    memberId: input.memberId,
    name: input.name,
    phone: input.phone,
    waNumber: input.waNumber,
    email: realEmail(input.email),
    city: input.city,
    role: f.role,
    signedUpAt: f.signedUpAt,
    creditedBy: input.creditedBy,
    kind: 'credit',
    step,
    stepLabel: stepLabel(f.role, step),
    nextStep: next,
    nextStepLabel: NEXT_STEP_LABEL[next],
    counted: reason === null,
    notCountedReason: reason,
    notCountedLabel: reason ? NOT_COUNTED_LABEL[reason] : null,
    paid: !!f.paidAt,
    paidAt: f.paidAt,
    staffId: input.staffId,
    waLink: text ? whatsAppLink(input.waNumber, text) : null,
  }
}

/** A claim of this staff member that is not credited to them. */
export function claimRow(input: {
  memberId: string
  staffId: string
  name: string
  maskedPhone: string | null
  role: MemberRole
  claimedAt: string
  status: 'pending' | 'rejected'
  reason: string | null
}): MySignupRow {
  const why = claimReason(input.status, input.reason)
  return {
    memberId: input.memberId,
    name: input.name,
    phone: input.maskedPhone,
    waNumber: null,
    email: null,
    city: null,
    role: input.role,
    signedUpAt: null,
    creditedBy: 'claim',
    kind: 'claim',
    step: null,
    stepLabel: '—',
    nextStep: null,
    nextStepLabel: '—',
    counted: false,
    notCountedReason: why,
    notCountedLabel: NOT_COUNTED_LABEL[why],
    paid: false,
    paidAt: null,
    staffId: input.staffId,
    waLink: null,
  }
}

// ----------------------------------------------------------------- filters

export type MonthFilter = 'all' | 'this' | 'last'
export type CountedFilter = 'all' | 'counted' | 'not_counted'
export type RoleFilter = 'all' | MemberRole

export type Filters = { role: RoleFilter; step: MyStep | 'all'; counted: CountedFilter; month: MonthFilter; q: string }

export const EMPTY_FILTERS: Filters = { role: 'all', step: 'all', counted: 'all', month: 'all', q: '' }

const PK_OFFSET_MS = 5 * 3600_000

/** [start, end) of this or last Pakistan-time month. */
export function monthBounds(which: 'this' | 'last', nowMs: number): { start: number; end: number } {
  const d = new Date(nowMs + PK_OFFSET_MS)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + (which === 'last' ? -1 : 0)
  return { start: Date.UTC(y, m, 1) - PK_OFFSET_MS, end: Date.UTC(y, m + 1, 1) - PK_OFFSET_MS }
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** A row's own date for the month filter: when it signed up (a claim: never). */
function inMonth(r: MySignupRow, which: 'this' | 'last', nowMs: number): boolean {
  const iso = r.signedUpAt ?? r.paidAt
  if (!iso) return false
  const t = Date.parse(iso)
  const b = monthBounds(which, nowMs)
  return Number.isFinite(t) && t >= b.start && t < b.end
}

/** Filter, search and sort (newest first). */
export function filterRows(rows: MySignupRow[], f: Filters, nowMs: number): MySignupRow[] {
  const q = f.q.trim().toLowerCase()
  const qDigits = digits(q)
  return rows
    .filter((r) => f.role === 'all' || r.role === f.role)
    .filter((r) => f.step === 'all' || r.step === f.step)
    .filter((r) => f.counted === 'all' || (f.counted === 'counted' ? r.counted : !r.counted))
    .filter((r) => f.month === 'all' || inMonth(r, f.month, nowMs))
    .filter((r) => {
      if (!q) return true
      if (r.name.toLowerCase().includes(q)) return true
      if (qDigits.length >= 3) {
        const p = digits(r.phone)
        // 0300… and 92300… are one number.
        const local = qDigits.startsWith('0') ? qDigits.slice(1) : qDigits.startsWith('92') ? qDigits.slice(2) : qDigits
        return p.includes(qDigits) || p.includes(local)
      }
      return false
    })
    .sort((a, b) => Date.parse(b.signedUpAt ?? '') - Date.parse(a.signedUpAt ?? '') || a.name.localeCompare(b.name))
}

/** Counted this Pakistan-time month (by the day the payment was approved) —
 *  the number Team activity shows on the person's card. */
export function countedInMonth(rows: MySignupRow[], nowMs: number): number {
  const b = monthBounds('this', nowMs)
  return rows.filter((r) => r.counted && r.paidAt && Date.parse(r.paidAt) >= b.start && Date.parse(r.paidAt) < b.end).length
}

/** The in-app notice to a staff member when someone signs up through their link. */
export function newSignupNoticeTitle(name: string, role: MemberRole): string {
  return `New sign-up through your link: ${name || 'someone'} (${role === 'tutor' ? 'Tutor' : 'Parent'})`
}

export const EMPTY_STATE = 'No sign-ups through your link yet. Share your link to get started.'

export const HOW_CREDIT_WORKS = [
  'When someone opens your link, you get the credit for 30 days.',
  'The first link they opened wins — a later link does not replace it.',
  'If someone signed up without your link, you can claim them within 30 days. The Owner approves claims.',
  'A sign-up is counted once they pay: a tutor’s Verification Fee or a parent’s plan, approved and not refunded.',
]
