// lib/parentFollowUpCore.ts — PURE, client-safe.
//
// Follow-ups → Parents works exactly like Follow-ups → Tutors (owner, 26 Oct
// 2026): every parent is in "To do" or "Followed up"; due again 3 days after
// the last message; 3 messages with no progress → "No reply after 3 messages";
// progress starts the count again but does not skip the 3-day wait; a
// 10-second sender-only Undo; the badge counts overdue To do only. The rules
// are lib/tutorFollowUpTabsCore's tabState, reused as they are.
//
// One situation per parent (the first that matches), each with its own
// message, editable in Team inbox → Templates → Parents:
//
//   waiting_forward   tutors applied to an open tuition and are not forwarded
//                     yet — WAITING ON US: no message, a link to Applications.
//   hired             a tutor was hired — thanks, and a request for a short
//                     review (sent once per hire).
//   expired           a tuition is no longer live with no hire, and no tuition
//                     is open — "Still looking? We can repost it".
//   no_applicants     a tuition open 2+ days with no application.
//   email_unconfirmed signed up with an email that is not confirmed.
//   no_tuition        signed up 1+ day ago and has never posted a tuition.
//
// No double messages: an Applications message to this parent in the last 3
// days counts as a contact (lib/applicationFollowUps), so they are not due here.

import { tabState, type ContactRecord, type TabState } from '@/lib/tutorFollowUpTabsCore'

const DAY = 86_400_000
export const NO_TUITION_AFTER_DAYS = 1
export const NO_APPLICANTS_AFTER_DAYS = 2
/** An Applications message this recent means the parent is not due here. */
export const APPLICATIONS_QUIET_DAYS = 3
/** The "Tutor hired" thanks is due within this many days of the hire. */
export const HIRED_THANKS_DAYS = 30

export const PARENT_REASONS = ['waiting_forward', 'hired', 'expired', 'no_applicants', 'email_unconfirmed', 'no_tuition'] as const
export type ParentReason = (typeof PARENT_REASONS)[number]

export function isParentReason(v: unknown): v is ParentReason {
  return typeof v === 'string' && (PARENT_REASONS as readonly string[]).includes(v)
}

export const PARENT_REASON_LABEL: Record<ParentReason, string> = {
  waiting_forward: 'Tutors applied — not forwarded yet',
  hired: 'Tutor hired',
  expired: 'Tuition ended with no hire',
  no_applicants: 'Tuition posted, no applicants',
  email_unconfirmed: 'Email not confirmed',
  no_tuition: 'Signed up, no tuition posted',
}

export type ParentTuition = {
  id: string
  title: string
  status: string
  createdAt: string
  publicPath: string | null
  /** Applications by real tutors, not withdrawn. */
  applications: number
  /** …of those, still at Applied and in no live forward. */
  waitingForward: number
  hiredAt: string | null
  hiredTutorName: string | null
  /** The hired application (its review link, owner 27 Oct 2026), or null. */
  hiredApplicationId?: string | null
}

export type ParentFacts = {
  joinedAt: string
  emailSignup: boolean
  emailConfirmed: boolean
  tuitions: ParentTuition[]
  /** When a "hired" thanks was last sent (any time), or null. */
  hiredThanksAt: string | null
}

export type ParentSituation = { reason: ParentReason; tuition: ParentTuition | null }

const ms = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : NaN
  return Number.isFinite(v) ? v : NaN
}

/** The parent's situation now, or null when there is nothing to follow up. */
export function parentSituation(f: ParentFacts, nowMs: number): ParentSituation | null {
  const open = f.tuitions.filter((t) => t.status === 'open')
  const waiting = open.find((t) => t.waitingForward > 0)
  if (waiting) return { reason: 'waiting_forward', tuition: waiting }

  const hires = f.tuitions.filter((t) => t.hiredAt).sort((a, b) => ms(b.hiredAt) - ms(a.hiredAt))
  const lastHire = hires[0] ?? null
  // A thank-you is sent once per hire, within 30 days of it.
  if (lastHire && nowMs - ms(lastHire.hiredAt) < HIRED_THANKS_DAYS * DAY && !(f.hiredThanksAt && ms(f.hiredThanksAt) >= ms(lastHire.hiredAt))) {
    return { reason: 'hired', tuition: lastHire }
  }

  if (open.length === 0) {
    const ended = f.tuitions
      .filter((t) => (t.status === 'paused' || t.status === 'closed') && !t.hiredAt)
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0]
    if (ended && !lastHire) return { reason: 'expired', tuition: ended }
  }

  const quiet = open
    .filter((t) => t.applications === 0 && nowMs - ms(t.createdAt) >= NO_APPLICANTS_AFTER_DAYS * DAY)
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0]
  if (quiet) return { reason: 'no_applicants', tuition: quiet }

  if (f.emailSignup && !f.emailConfirmed) return { reason: 'email_unconfirmed', tuition: null }

  if (f.tuitions.length === 0 && nowMs - ms(f.joinedAt) >= NO_TUITION_AFTER_DAYS * DAY) {
    return { reason: 'no_tuition', tuition: null }
  }
  return null
}

/** A snapshot of how far a parent has got — any change starts the count again. */
export function parentProgressKey(f: ParentFacts, s: ParentSituation): string {
  const apps = f.tuitions.reduce((n, t) => n + t.applications, 0)
  const hires = f.tuitions.filter((t) => t.hiredAt).length
  const open = f.tuitions.filter((t) => t.status === 'open').length
  return `${s.reason}|t${f.tuitions.length}|o${open}|a${apps}|h${hires}|e${f.emailConfirmed ? 1 : 0}`
}

/**
 * The tab state. Applications messages to this parent in the last 3 days are
 * added as contacts with no progress snapshot: they keep the parent in
 * Followed up (not due) but never count towards "3 messages with no progress".
 */
export function parentTabState(
  f: ParentFacts,
  s: ParentSituation,
  contacts: ContactRecord[],
  applicationMessagesAt: string[],
  nowMs: number,
  applicationsHref: string,
): TabState {
  const recentApp = applicationMessagesAt
    .filter((at) => nowMs - ms(at) < APPLICATIONS_QUIET_DAYS * DAY)
    .map((at): ContactRecord => ({ at, progress: null, staffName: null, templateKey: 'applications' }))
  const state = tabState(
    {
      joinedAt: f.joinedAt,
      progress: parentProgressKey(f, s),
      waitingOnUs: s.reason === 'waiting_forward',
      contacts: [...contacts, ...recentApp],
    },
    nowMs,
  )
  if (s.reason === 'waiting_forward') return { ...state, action: { label: 'Tutors to forward', href: applicationsHref } }
  return state
}

// ------------------------------------------------------------- templates

export const PARENT_TEMPLATE_KEY: Record<Exclude<ParentReason, 'waiting_forward'>, string> = {
  no_tuition: 'pf_no_tuition',
  no_applicants: 'pf_no_applicants',
  email_unconfirmed: 'pf_email_unconfirmed',
  expired: 'pf_expired',
  hired: 'pf_hired',
}

export const PARENT_PLACEHOLDERS = ['first_name', 'tuition_title', 'tuition_link', 'post_link', 'tutor_name', 'review_link', 'support_whatsapp'] as const

export const PARENT_PLACEHOLDER_HELP: Record<(typeof PARENT_PLACEHOLDERS)[number], string> = {
  first_name: "The parent's first name",
  tuition_title: 'The tuition the message is about',
  tuition_link: 'The tuition’s page',
  post_link: 'Where they post a tuition',
  tutor_name: 'The tutor they hired (the "Tutor hired" message)',
  review_link: 'Where they review the tutor they hired (the "Tutor hired" message)',
  support_whatsapp: 'Our support WhatsApp number (from settings)',
}

const SUPPORT = 'Need help? WhatsApp us on {support_whatsapp}'

/** The five messages' built-in wording — what migration 201 seeds (pf_hired
 *  gained the review link in migration 204, owner, 27 Oct 2026).
 *  Short, plain English, no prices, each ending with {support_whatsapp}. */
export const PARENT_DEFAULTS: Record<string, string> = {
  pf_no_tuition:
    'Assalam o Alaikum {first_name}, thank you for joining TutorMint. Posting a tuition is free: tell us the class, subjects and area, and verified tutors can apply.\nYou can post it here:\n{post_link}\n\n' + SUPPORT,
  pf_no_applicants:
    'Assalam o Alaikum {first_name}, your tuition "{tuition_title}" is live on TutorMint, but no tutor has applied yet. Adding timings and more detail helps tutors decide.\nYou can see it here:\n{tuition_link}\n\n' + SUPPORT,
  pf_email_unconfirmed:
    'Assalam o Alaikum {first_name}, thank you for signing up to TutorMint. Please open the email we sent you and tap the link to confirm your address. If it is not in your inbox, check your spam folder.\n\n' + SUPPORT,
  pf_expired:
    'Assalam o Alaikum {first_name}, your tuition "{tuition_title}" is no longer live on TutorMint. Still looking? We can repost it — just reply to this message.\n\n' + SUPPORT,
  pf_hired:
    'Assalam o Alaikum {first_name}, thank you for hiring {tutor_name} through TutorMint. We hope the lessons go well. Could you leave a short review of the tutor? It helps other parents.\nYou can leave it here:\n{review_link}\n\n' + SUPPORT,
}

export const PARENT_TEMPLATES: readonly { key: string; title: string; reason: ParentReason }[] = [
  { key: 'pf_no_tuition', title: 'Parents — signed up, no tuition posted', reason: 'no_tuition' },
  { key: 'pf_no_applicants', title: 'Parents — tuition posted, no applicants', reason: 'no_applicants' },
  { key: 'pf_email_unconfirmed', title: 'Parents — email not confirmed', reason: 'email_unconfirmed' },
  { key: 'pf_expired', title: 'Parents — tuition ended, still looking?', reason: 'expired' },
  { key: 'pf_hired', title: 'Parents — tutor hired, thanks', reason: 'hired' },
]

export type ParentValues = {
  firstName: string
  tuitionTitle?: string | null
  tuitionLink?: string | null
  postLink: string
  tutorName?: string | null
  reviewLink?: string | null
  supportWhatsapp: string
}

/** The message: every placeholder filled (an empty one removed cleanly). */
export function fillParentFollowUp(body: string, v: ParentValues): string {
  const values: Record<string, string> = {
    first_name: v.firstName || 'there',
    tuition_title: v.tuitionTitle ?? '',
    tuition_link: v.tuitionLink ?? '',
    post_link: v.postLink,
    tutor_name: v.tutorName || 'your tutor',
    review_link: v.reviewLink ?? '',
    support_whatsapp: v.supportWhatsapp,
  }
  return body
    .trim()
    .replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ------------------------------------------------------------- chips

/** The People page's chips, kept here (owner, 26 Oct 2026). */
export type ParentChip = 'all' | 'posted' | 'not_posted' | 'waiting' | 'verified' | 'not_submitted'
export const PARENT_CHIP_LABEL: Record<ParentChip, string> = {
  all: 'All',
  posted: 'Posted a tuition',
  not_posted: 'Not posted yet',
  waiting: 'Waiting for review',
  verified: 'Verified',
  not_submitted: 'Not submitted',
}
export function parseParentChip(v: string | null | undefined): ParentChip {
  return v && v in PARENT_CHIP_LABEL ? (v as ParentChip) : 'all'
}
export function parentChipMatch(chip: ParentChip, r: { posted: boolean; verification: 'waiting' | 'verified' | 'not_submitted' | 'rejected' }): boolean {
  if (chip === 'all') return true
  if (chip === 'posted') return r.posted
  if (chip === 'not_posted') return !r.posted
  return r.verification === chip
}
