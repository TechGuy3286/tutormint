// lib/followUpTemplatesCore.ts
//
// PURE, client-safe. Follow-ups → Tutors pre-fills ONE message per reason a
// tutor is stuck (owner, 23 Oct 2026). Each is a template in Team inbox →
// Templates, in the "Follow-ups" group, with the same editor, placeholders,
// preview, Reset, warnings and fallback as the Applications group.
//
// Existing stored templates are REUSED as they are (their wording, Urdu text
// included, is never changed here):
//   no_mobile       signup_mobile_unverified
//   profile         profile_completion_nudge
//   payment         payment_not_finished
//   fee_due         fee_not_paid
// Four are new (seeded by migration 196, short plain English, no price):
//   no_cnic         fu_no_cnic
//   no_photo        fu_no_photo
//   reupload        fu_reupload
//   paid_unfinished fu_paid_unfinished
// "Waiting on us" (documents waiting for the Owner) is not a message: it stays
// in To do with the action to take, and has no template.
//
// Every message ends with the support number from settings: a template with
// {support_whatsapp} gets it in place; one without gets a short support line
// added, unless the number is already written in it. The link the tutor needs
// goes on its own line when the template has no link placeholder.
//
// Unit-tested by scripts/test-tutor-journey.ts.

import { fillTemplate as fillApp, templateWarnings, type AppTemplateDef } from '@/lib/applicationTemplatesCore'
import { PAYMENT_NOT_FINISHED_FALLBACK, PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'
import type { FollowStep, RejectedDoc, TutorFollowFacts } from '@/lib/tutorFollowUpCore'

export const FOLLOW_REASONS = ['reupload', 'waiting', 'payment', 'fee_due', 'no_mobile', 'no_cnic', 'no_photo', 'paid_unfinished', 'profile'] as const
export type FollowReason = (typeof FOLLOW_REASONS)[number]

export const FOLLOW_REASON_LABEL: Record<FollowReason, string> = {
  reupload: 'Document to upload again',
  waiting: 'Waiting on us',
  payment: "Payment started, didn't finish",
  fee_due: 'Documents approved, fee not paid',
  no_mobile: 'Mobile not verified',
  no_cnic: 'No CNIC',
  no_photo: 'No photo or selfie',
  paid_unfinished: 'Paid, profile not finished',
  profile: 'Profile not finished',
}

export function isFollowReason(v: unknown): v is FollowReason {
  return typeof v === 'string' && (FOLLOW_REASONS as readonly string[]).includes(v)
}

const CNIC_STEPS: readonly (FollowStep | null)[] = ['cnic_number', 'cnic_photos']
const PHOTO_STEPS: readonly (FollowStep | null)[] = ['photo', 'selfie']
const isFeeStep = (s: FollowStep | null) => s === null || s === 'verify'

/** Why this tutor is stuck — first match wins (the card's reason line runs in
 *  the same order, lib/tutorFollowUpCore reasonKind). */
export function followReasonFor(
  f: Pick<TutorFollowFacts, 'rejected' | 'docsWaiting' | 'startedPayment' | 'feePaid' | 'docsApproved' | 'stoppedStep'>,
): FollowReason {
  if (f.rejected.length > 0) return 'reupload'
  if (f.docsWaiting) return 'waiting'
  if (f.startedPayment) return 'payment'
  if (!f.feePaid && f.docsApproved && isFeeStep(f.stoppedStep)) return 'fee_due'
  if (f.stoppedStep === 'mobile' || f.stoppedStep === 'contact') return 'no_mobile'
  if (CNIC_STEPS.includes(f.stoppedStep)) return 'no_cnic'
  if (PHOTO_STEPS.includes(f.stoppedStep)) return 'no_photo'
  if (f.feePaid) return 'paid_unfinished'
  return 'profile'
}

export type FuTemplateKey =
  | 'signup_mobile_unverified'
  | 'profile_completion_nudge'
  | typeof PAYMENT_NOT_FINISHED_KEY
  | 'fee_not_paid'
  | 'fu_no_cnic'
  | 'fu_no_photo'
  | 'fu_reupload'
  | 'fu_paid_unfinished'

/** The template each reason sends; null = not a message (waiting on us). */
export const REASON_TEMPLATE: Record<FollowReason, FuTemplateKey | null> = {
  reupload: 'fu_reupload',
  waiting: null,
  payment: PAYMENT_NOT_FINISHED_KEY,
  fee_due: 'fee_not_paid',
  no_mobile: 'signup_mobile_unverified',
  no_cnic: 'fu_no_cnic',
  no_photo: 'fu_no_photo',
  paid_unfinished: 'fu_paid_unfinished',
  profile: 'profile_completion_nudge',
}

/** Every placeholder a Follow-ups template may use. */
export const FU_PLACEHOLDERS = [
  'name',
  'first_name',
  'completion',
  'next_step',
  'continue_link',
  'pay_link',
  'document',
  'reason',
  'support_whatsapp',
] as const

export const FU_PLACEHOLDER_HELP: Record<(typeof FU_PLACEHOLDERS)[number], string> = {
  name: "The tutor's first name (older templates use {name})",
  first_name: "The tutor's first name",
  completion: 'How complete their profile is, e.g. 60',
  next_step: 'Their next step in words, e.g. "add your profile photo"',
  continue_link: 'Where they continue (their dashboard)',
  pay_link: 'The page to pay again',
  document: 'The document to upload again, e.g. "selfie"',
  reason: 'Why it was not approved, as a sentence (left out when staff gave none)',
  support_whatsapp: 'Our support WhatsApp number (from settings)',
}

const SUPPORT_LINE = 'Need help? WhatsApp us on {support_whatsapp}.'

/** The four new templates' built-in wording — exactly what migration 196 seeds. */
export const FU_NEW_DEFAULTS: Record<'fu_no_cnic' | 'fu_no_photo' | 'fu_reupload' | 'fu_paid_unfinished', string> = {
  fu_no_cnic:
    'Assalam o Alaikum {first_name}, your TutorMint profile is {completion}% complete. The next step is to add your CNIC: the number and a clear photo of both sides. Only our verification team sees it, and it never shows on your profile.\nYou can add it here:\n{continue_link}\n\n' +
    SUPPORT_LINE,
  fu_no_photo:
    'Assalam o Alaikum {first_name}, your TutorMint profile is {completion}% complete. The next step is to {next_step}. A clear photo helps parents trust you, and the selfie lets us check it is really you.\nYou can do it here:\n{continue_link}\n\n' +
    SUPPORT_LINE,
  fu_reupload:
    'Assalam o Alaikum {first_name}, we could not approve your {document}. {reason}\nPlease upload it again and we will check it.\nYou can upload it here:\n{continue_link}\n\n' +
    SUPPORT_LINE,
  fu_paid_unfinished:
    'Assalam o Alaikum {first_name}, thank you for getting verified on TutorMint. Your profile is {completion}% complete, and the next step is to {next_step}. A finished profile helps parents choose you.\nYou can finish it here:\n{continue_link}\n\n' +
    SUPPORT_LINE,
}

/** The reused templates' stored wording (their seeds), for "Reset to default"
 *  and as the fallback when a stored body is empty. Never edited here. */
export const FU_REUSED_DEFAULTS: Record<'signup_mobile_unverified' | 'profile_completion_nudge' | 'payment_not_finished' | 'fee_not_paid', string> = {
  signup_mobile_unverified:
    'Hi {name}, thanks for signing up to TutorMint. To finish, enter the verification code we sent to your mobile by SMS — that unlocks your account. If you did not receive a code, reply to this message and our team will verify your number for you.',
  profile_completion_nudge:
    'Hi {name}, your profile is not yet complete, so parents cannot find you in search. Completing it to 100% is what lists you and lets you get hired. Open your dashboard to see exactly what is left.',
  payment_not_finished: PAYMENT_NOT_FINISHED_FALLBACK,
  fee_not_paid:
    "Hi {name},\n\nYou're almost there. The one-time verification fee is the last step to become a verified tutor. You can complete it from the Get verified step in your profile.\n\nThe TutorMint Team\n\n— — —\n\nالسلام علیکم {name}،\n\nآپ بس ایک قدم کی دوری پر ہیں۔ تصدیق شدہ ٹیوٹر بننے کے لیے ایک بار کی ویریفیکیشن فیس آخری مرحلہ ہے۔ آپ اسے اپنی پروفائل میں ”تصدیق کروائیں“ کے مرحلے سے مکمل کر سکتے ہیں۔\n\nٹیوٹر منٹ ٹیم",
}

export type FuTemplateDef = { key: FuTemplateKey; title: string; reason: FollowReason; isNew: boolean; defaultBody: string }

/** The Follow-ups group, in the order the reasons run. */
export const FU_TEMPLATES: readonly FuTemplateDef[] = [
  { key: 'fu_reupload', title: 'Follow-ups — document to upload again', reason: 'reupload', isNew: true, defaultBody: FU_NEW_DEFAULTS.fu_reupload },
  { key: PAYMENT_NOT_FINISHED_KEY, title: "Started payment, didn't finish", reason: 'payment', isNew: false, defaultBody: FU_REUSED_DEFAULTS.payment_not_finished },
  { key: 'fee_not_paid', title: 'One step left to get verified', reason: 'fee_due', isNew: false, defaultBody: FU_REUSED_DEFAULTS.fee_not_paid },
  { key: 'signup_mobile_unverified', title: 'Signup — mobile not verified', reason: 'no_mobile', isNew: false, defaultBody: FU_REUSED_DEFAULTS.signup_mobile_unverified },
  { key: 'fu_no_cnic', title: 'Follow-ups — CNIC not added', reason: 'no_cnic', isNew: true, defaultBody: FU_NEW_DEFAULTS.fu_no_cnic },
  { key: 'fu_no_photo', title: 'Follow-ups — photo or selfie not added', reason: 'no_photo', isNew: true, defaultBody: FU_NEW_DEFAULTS.fu_no_photo },
  { key: 'fu_paid_unfinished', title: 'Follow-ups — paid, profile not finished', reason: 'paid_unfinished', isNew: true, defaultBody: FU_NEW_DEFAULTS.fu_paid_unfinished },
  { key: 'profile_completion_nudge', title: 'Finish your profile', reason: 'profile', isNew: false, defaultBody: FU_REUSED_DEFAULTS.profile_completion_nudge },
]

export const FU_TEMPLATE_KEYS: readonly string[] = FU_TEMPLATES.map((t) => t.key)

export function fuTemplateDef(key: string): FuTemplateDef | null {
  return FU_TEMPLATES.find((t) => t.key === key) ?? null
}

/** As an Applications-style definition, so the shared save/fallback rules apply. */
export function asAppDef(d: FuTemplateDef): AppTemplateDef {
  return { key: d.key as AppTemplateDef['key'], title: d.title, recipient: 'tutor', stage: null, placeholders: FU_PLACEHOLDERS, defaultBody: d.defaultBody }
}

export type FuValues = {
  firstName: string
  completion: number
  nextStep: string
  continueLink: string
  payLink: string
  document?: string | null
  reason?: string | null
  supportWhatsapp: string
}

const digitsOf = (s: string) => s.replace(/\D/g, '')

/**
 * The message: placeholders filled (an empty value is removed cleanly), the
 * link on its own line when the template has no link placeholder, and the
 * support number when the template neither uses {support_whatsapp} nor already
 * names the number.
 */
export function fillFollowUp(body: string, v: FuValues, linkKind: 'continue' | 'pay' = 'continue'): string {
  const values: Record<string, string> = {
    name: v.firstName,
    first_name: v.firstName,
    completion: String(Math.max(0, Math.min(100, Math.round(v.completion || 0)))),
    next_step: v.nextStep,
    continue_link: v.continueLink,
    pay_link: v.payLink,
    document: v.document ?? '',
    reason: v.reason ?? '',
    support_whatsapp: v.supportWhatsapp,
  }
  const hasLink = /\{(continue_link|pay_link)\}/.test(body)
  const hasSupport = /\{support_whatsapp\}/.test(body)
  let text = fillApp(body.trim(), values).replace(/[ \t]+\n/g, '\n')
  if (!hasLink) text = `${text}\n\n${linkKind === 'pay' ? v.payLink : v.continueLink}`
  const sup = digitsOf(v.supportWhatsapp).slice(-7)
  if (!hasSupport && (!sup || !digitsOf(text).includes(sup))) text = `${text}\n\n${SUPPORT_LINE.replace('{support_whatsapp}', v.supportWhatsapp)}`
  return text
}

/** "selfie", "CNIC photos and profile photo". */
export function documentWords(rejected: RejectedDoc[]): string {
  const word: Record<RejectedDoc['doc'], string> = { cnic: 'CNIC photos', photo: 'profile photo', selfie: 'selfie' }
  const parts = [...new Set(rejected.map((r) => word[r.doc]))]
  if (parts.length <= 1) return parts[0] ?? 'document'
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Reason: photo not clear." — or '' when staff gave none. */
export function reasonSentence(rejected: RejectedDoc[]): string {
  const reasons = [...new Set(rejected.map((r) => (r.reason ?? '').trim().replace(/[.\s]+$/, '')).filter(Boolean))]
  return reasons.length ? `Reason: ${reasons.join('; ')}.` : ''
}

export { templateWarnings }
