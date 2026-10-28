// lib/notify/emailWordingCore.ts
//
// PURE. The member-facing emails in simple English (owner, 28 Oct 2026). Each
// email (or each version of one — a welcome for a tutor and for a parent are
// two) is a PROPOSED wording until the Owner approves it in Team inbox →
// Templates → Review new wording. Until then lib/notify/templates.ts keeps
// sending the built-in wording, exactly as before.
//
// An approved wording is stored in email_wordings (subject + body) and sent
// through renderWording(): the {link} line becomes the button, the lines
// before it the paragraphs, the support line follows the button.
//
// emailWordingFor(input) maps a TemplateInput to its wording key and the
// values its placeholders fill with. Staff emails (payment alerts, the SMS
// alert, the content digest, staff invites…) and the two wrappers (an admin's
// own Team message, the daily summary) are not rewritten: they are not
// member-facing wording, and their text comes from elsewhere.

import type { Proposal } from '@/lib/templateProposals'
import type { TemplateInput } from '@/lib/notify/templates'

const SUPPORT_LINE = 'Need help? WhatsApp {support_whatsapp}'
const S = `\n\n${SUPPORT_LINE}`

export type EmailVariant =
  | 'welcome_tutor'
  | 'welcome_parent'
  | 'verification_approved'
  | 'verification_not_approved'
  | 'verification_hold'
  | 'application_hired'
  | 'application_shortlisted'
  | 'message_digest'
  | 'plan_activated'
  | 'verification_fee_paid'
  | 'plan_granted'
  | 'plan_expiring'
  | 'plan_expired'
  | 'account_banned'
  | 'tutor_alert'
  | 'confirm_email'
  | 'switched_tutor_signin'
  | 'account_type_tutor'
  | 'account_type_parent'
  | 'account_erased'
  | 'tuition_paused'
  | 'refund_recorded'
  | 'document_rejected_tutor'
  | 'document_rejected_parent'
  | 'document_approved_tutor'
  | 'document_approved_parent'
  | 'tuition_match'

export const emailKey = (v: EmailVariant) => `email:${v}`

function email(
  variant: EmailVariant,
  title: string,
  recipient: Proposal['recipient'],
  subject: string,
  lines: string[],
  button: string | null,
  allowed: string[],
  extra: Partial<Proposal> = {},
): Proposal {
  const head = lines.join('\n')
  return {
    key: emailKey(variant),
    kind: 'email',
    title,
    recipient,
    subject,
    button: button ?? undefined,
    body: button ? `${head}\n{link}${S}` : `${head}${S}`,
    allowed: [...allowed, 'first_name', 'support_whatsapp', ...(button ? ['link'] : [])],
    links: button ? ['link'] : [],
    noLink: !button,
    ...extra,
  }
}

const hi = 'Hi {first_name},'
const hello = 'Assalam o Alaikum,'

export const EMAIL_PROPOSALS: readonly Proposal[] = [
  email('welcome_tutor', 'Email — welcome (tutor)', 'tutor', 'Welcome to TutorMint', [
    hi,
    'Your TutorMint account is ready. Finish your profile so parents can find you.',
  ], 'Finish your profile', []),
  email('welcome_parent', 'Email — welcome (parent)', 'parent', 'Welcome to TutorMint', [
    hi,
    'Your TutorMint account is ready. Post your tuition for free, and verified tutors near you can apply.',
  ], 'Post your tuition', []),
  email('verification_approved', 'Email — check approved', 'member', 'Your {document} is approved', [
    hi,
    'We checked your {document} and it is approved.',
  ], 'Open TutorMint', ['document']),
  email('verification_not_approved', 'Email — check not approved', 'member', 'Your {document} was not approved', [
    hi,
    'We could not approve your {document}. {reason}',
    'Please fix it and send it again here:',
  ], 'Open TutorMint', ['document', 'reason']),
  email('verification_hold', 'Email — check on hold', 'member', 'Your {document} needs a change', [
    hi,
    'We need a change to your {document} before we can approve it. {reason}',
    'You can make the change here:',
  ], 'Open TutorMint', ['document', 'reason']),
  email('application_hired', 'Email — tutor hired', 'tutor', 'You got the tuition: {tuition}', [
    hi,
    'Congratulations! The parent has chosen you for tuition {tuition}.',
    'Message them to agree the first lesson:',
  ], 'Open the tuition', ['tuition']),
  email('application_shortlisted', 'Email — tutor shortlisted', 'tutor', 'You are shortlisted: {tuition}', [
    hi,
    'The parent has shortlisted you for tuition {tuition}. They may message you soon.',
  ], 'Open the tuition', ['tuition']),
  email('message_digest', 'Email — new messages', 'member', 'You have {count_text} on TutorMint', [
    hi,
    'You have {count_text}{from_text}. We do not put messages in emails.',
    'You can read them here:',
  ], 'Read your messages', ['count_text', 'from_text']),
  email('plan_activated', 'Email — plan receipt', 'member', 'Your {plan} plan is active', [
    hi,
    'Thank you for your payment of {amount}. Your {plan} plan is active until {until}.',
    'Plans are non-refundable, as our Terms say.',
  ], 'See your plan', ['plan', 'amount', 'until'], { receipt: true }),
  email('verification_fee_paid', 'Email — Verification Fee receipt', 'tutor', 'You are verified on TutorMint', [
    hi,
    'Thank you for your payment of {amount}. Parents can now see your profile.',
    'The Verification Fee is one-time and non-refundable, as our Terms say.',
  ], 'Open TutorMint', ['amount'], { receipt: true }),
  email('plan_granted', 'Email — plan given by our team', 'member', 'Your {plan} plan is active', [
    hi,
    'Your {plan} plan is now active. {unlocks}',
    '{badge_note}',
  ], 'Open TutorMint', ['plan', 'unlocks', 'badge_note']),
  email('plan_expiring', 'Email — plan ending soon', 'tutor', 'Your {plan} plan ends in {days} days', [
    hi,
    'In {days} days your {plan} plan ends, and other tutors will show above you.',
    'Renew before then to keep your place:',
  ], 'Renew your plan', ['plan', 'days']),
  email('plan_expired', 'Email — plan ended', 'tutor', 'Your {plan} plan has ended', [
    hi,
    'Your {plan} plan has ended, so other tutors now show above you. Nothing has been deleted.',
    'You can start a plan again here:',
  ], 'See the plans', ['plan']),
  email('account_banned', 'Email — account closed for fraud', 'member', 'Your TutorMint account has been closed', [
    hi,
    'Your account has been closed because of fraud.',
    'If you think this is a mistake, please contact us here:',
  ], 'Contact us', []),
  email('tutor_alert', 'Email — a matching tutor joined', 'parent', 'A tutor matching your search has joined', [
    hello,
    'A tutor matching your search has joined TutorMint: {search}. This is the only email for this request.',
    'You can see the tutor here:',
  ], 'See the tutor', ['search'], { noName: true }),
  email('confirm_email', 'Email — confirm your email', 'member', 'Confirm your email for TutorMint', [
    hi,
    'Please confirm this email address is yours. If you did not sign up, you can ignore this email.',
  ], 'Confirm my email', []),
  email('switched_tutor_signin', 'Email — you can now sign in', 'tutor', 'You can now sign in to TutorMint', [
    hi,
    'You can now sign in with your email and the password you chose. Then add and check your mobile number.',
  ], 'Sign in', []),
  email('account_type_tutor', 'Email — account changed to Tutor', 'tutor', 'Your account is now a Tutor account', [
    hi,
    'We changed your TutorMint account to a Tutor account, as you asked. You sign in the same way.',
    'Next, finish your tutor profile so parents can find you:',
  ], 'Finish your profile', []),
  email('account_type_parent', 'Email — account changed to Parent', 'parent', 'Your account is now a Parent account', [
    hi,
    'We changed your TutorMint account to a Parent account, as you asked. You sign in the same way.',
    'You can now post your tuition for free:',
  ], 'Post your tuition', []),
  email('account_erased', 'Email — account closed and data deleted', 'member', 'Your TutorMint account has been closed', [
    hello,
    'Your TutorMint account is closed and your personal data has been deleted. You will not get any more emails from us.',
  ], null, [], { noName: true }),
  email('tuition_paused', 'Email — tuition paused', 'parent', 'Your tuition is paused', [
    hello,
    'Your tuition "{tuition}" has been open for {live_days}, so it is now paused and tutors cannot apply.',
    'You can put it back for another {live_days} here:',
  ], 'Resume your tuition', ['tuition', 'live_days'], { noName: true }),
  email('refund_recorded', 'Email — refund sent', 'member', 'Your refund has been sent', [
    hello,
    'We sent your refund of {amount} to your {method} on {date}. It can take a few days to arrive.',
  ], null, ['amount', 'method', 'date'], { noName: true, receipt: true }),
  email('document_rejected_tutor', 'Email — document not approved (tutor)', 'tutor', 'Please upload your {document} again', [
    hi,
    'We could not approve your {document}: {reason}',
    'Please upload a clear one here:',
  ], 'Upload it again', ['document', 'reason']),
  email('document_rejected_parent', 'Email — document not approved (parent)', 'parent', 'Please check your {document}', [
    hi,
    'We could not approve your {document}: {reason}',
    'You can correct it here:',
  ], 'Correct it', ['document', 'reason']),
  email('document_approved_tutor', 'Email — document approved (tutor)', 'tutor', 'Your {document} is approved', [
    hi,
    'We checked your {document} and it is approved. {note}',
  ], 'Open TutorMint', ['document', 'note']),
  email('document_approved_parent', 'Email — document approved (parent)', 'parent', 'Your {document} is approved', [
    hi,
    'We checked your {document} and it is approved. {note}',
  ], 'Open TutorMint', ['document', 'note']),
  email('tuition_match', 'Email — a new tuition for you', 'tutor', 'A new tuition for you on TutorMint', [
    hello,
    'A new tuition matches your subjects: {subject} in {where}{mode_text}.',
    'You can see the details and apply here:',
  ], 'See the tuition', ['subject', 'where', 'mode_text'], { noName: true }),
]

export type WordingFill = {
  variant: EmailVariant
  values: Record<string, string>
  /** Where the button goes (relative paths are made absolute by the shell). */
  href: string | null
}

const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || ''
const pkr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`

/** Which wording an email uses, and what fills it. Null = not rewritten. */
export function emailWordingFor(input: TemplateInput, liveDays: string): WordingFill | null {
  switch (input.id) {
    case 'welcome':
      return input.role === 'tutor'
        ? { variant: 'welcome_tutor', values: { first_name: first(input.name) }, href: '/tutor/complete-profile' }
        : { variant: 'welcome_parent', values: { first_name: first(input.name) }, href: '/post-tuition' }
    case 'verification_decision': {
      const document = input.subjectOfDecision === 'video' ? 'introduction video' : input.subjectOfDecision === 'cnic' ? 'CNIC and address' : 'profile'
      const reason = input.reason?.trim() ? `Reason: ${input.reason.trim().replace(/[.\s]+$/, '')}.` : ''
      const variant = input.decision === 'approved' ? 'verification_approved' : input.decision === 'hold' ? 'verification_hold' : 'verification_not_approved'
      return { variant, values: { first_name: first(input.name), document, reason }, href: '/' }
    }
    case 'application_progress': {
      const tuition = input.ref ? `${input.jobTitle} (${input.ref})` : input.jobTitle
      return {
        variant: input.outcome === 'hired' ? 'application_hired' : 'application_shortlisted',
        values: { first_name: first(input.name), tuition },
        href: input.href,
      }
    }
    case 'message_digest': {
      const count_text = input.count === 1 ? 'a new message' : `${input.count} new messages`
      const from_text =
        input.from.length === 0 ? '' : ` from ${input.from.slice(0, 3).join(', ')}${input.from.length > 3 ? ' and others' : ''}`
      return { variant: 'message_digest', values: { first_name: first(input.name), count_text, from_text }, href: '/messages' }
    }
    case 'plan_activated':
      return {
        variant: 'plan_activated',
        values: { first_name: first(input.name), plan: input.planName, amount: pkr(input.amountPkr), until: input.expiresAt },
        href: '/',
      }
    case 'verification_fee_paid':
      return { variant: 'verification_fee_paid', values: { first_name: first(input.name), amount: pkr(input.amountPkr) }, href: '/tutor/dashboard' }
    case 'plan_granted':
      return {
        variant: 'plan_granted',
        values: {
          first_name: first(input.name),
          plan: input.planName,
          unlocks: input.unlocks,
          badge_note: input.listed ? '' : 'Your badge shows on your profile once your identity and mobile number are checked.',
        },
        href: '/',
      }
    case 'plan_expiring':
      return { variant: 'plan_expiring', values: { first_name: first(input.name), plan: input.planName, days: String(input.daysLeft) }, href: '/membership-plans?for=tutors' }
    case 'plan_expired':
      return { variant: 'plan_expired', values: { first_name: first(input.name), plan: input.planName }, href: '/membership-plans?for=tutors' }
    case 'account_banned':
      return { variant: 'account_banned', values: { first_name: first(input.name) }, href: '/support' }
    case 'tutor_alert':
      return { variant: 'tutor_alert', values: { search: input.label }, href: input.url }
    case 'confirm_email':
      return { variant: 'confirm_email', values: { first_name: first(input.name) }, href: input.url }
    case 'switched_tutor_signin':
      return { variant: 'switched_tutor_signin', values: { first_name: first(input.name) }, href: '/login' }
    case 'account_type_changed':
      return input.to === 'tutor'
        ? { variant: 'account_type_tutor', values: { first_name: first(input.name) }, href: '/tutor/dashboard' }
        : { variant: 'account_type_parent', values: { first_name: first(input.name) }, href: '/post-tuition' }
    case 'account_erased':
      return { variant: 'account_erased', values: {}, href: null }
    case 'tuition_paused':
      return { variant: 'tuition_paused', values: { tuition: input.title, live_days: liveDays }, href: input.href ?? '/parent/dashboard/jobs' }
    case 'refund_recorded':
      return { variant: 'refund_recorded', values: { amount: pkr(input.amountPkr), method: input.method, date: input.whenDate }, href: null }
    case 'verification_rejected':
      return {
        variant: input.audience === 'parent' ? 'document_rejected_parent' : 'document_rejected_tutor',
        values: { first_name: first(input.name), document: input.what, reason: input.reason },
        href: input.href,
      }
    case 'document_approved':
      return {
        variant: input.audience === 'parent' ? 'document_approved_parent' : 'document_approved_tutor',
        values: { first_name: '', document: input.what, note: input.note ?? '' },
        href: input.href,
      }
    case 'tuition_match':
      return {
        variant: 'tuition_match',
        values: { subject: input.subject, where: input.area ? `${input.area}, ${input.city}` : input.city, mode_text: input.mode ? ` (${input.mode})` : '' },
        href: input.href,
      }
    default:
      return null
  }
}

/** One sample input per wording, for the review page's "live" text and preview. */
export const EMAIL_SAMPLE_INPUTS: Record<EmailVariant, TemplateInput> = {
  welcome_tutor: { id: 'welcome', name: 'Rida Saeed', role: 'tutor' },
  welcome_parent: { id: 'welcome', name: 'Sana Ahmed', role: 'parent' },
  verification_approved: { id: 'verification_decision', name: 'Rida Saeed', decision: 'approved', subjectOfDecision: 'video' },
  verification_not_approved: { id: 'verification_decision', name: 'Rida Saeed', decision: 'rejected', subjectOfDecision: 'video', reason: 'The sound is not clear' },
  verification_hold: { id: 'verification_decision', name: 'Rida Saeed', decision: 'hold', subjectOfDecision: 'video', reason: 'The sound is not clear' },
  application_hired: { id: 'application_progress', name: 'Rida Saeed', outcome: 'hired', jobTitle: 'Home Tutor Required | Grade 5', ref: 'TM-1303', href: '/tuitions/lahore/sample-1a2b3c' },
  application_shortlisted: { id: 'application_progress', name: 'Rida Saeed', outcome: 'shortlisted', jobTitle: 'Home Tutor Required | Grade 5', ref: 'TM-1303', href: '/tuitions/lahore/sample-1a2b3c' },
  message_digest: { id: 'message_digest', name: 'Sana Ahmed', count: 2, from: ['Rida Saeed'] },
  plan_activated: { id: 'plan_activated', name: 'Sana Ahmed', planName: 'Featured', expiresAt: '28 Nov 2026', amountPkr: 999 },
  verification_fee_paid: { id: 'verification_fee_paid', name: 'Rida Saeed', amountPkr: 199 },
  plan_granted: { id: 'plan_granted', name: 'Rida Saeed', planName: 'Premium', unlocks: 'You can now see parents’ numbers and message them on WhatsApp.', listed: false },
  plan_expiring: { id: 'plan_expiring', name: 'Rida Saeed', planName: 'Premium', daysLeft: 3 },
  plan_expired: { id: 'plan_expired', name: 'Rida Saeed', planName: 'Premium' },
  account_banned: { id: 'account_banned', name: 'Rida Saeed' },
  tutor_alert: { id: 'tutor_alert', label: 'Maths tutor in Lahore', url: '/tutor/rida-saeed-tutor' },
  confirm_email: { id: 'confirm_email', name: 'Rida Saeed', url: '/api/auth/confirm-email?u=sample' },
  switched_tutor_signin: { id: 'switched_tutor_signin', name: 'Rida Saeed', supportWhatsapp: '0321 5872222' },
  account_type_tutor: { id: 'account_type_changed', name: 'Sana Ahmed', to: 'tutor', supportWhatsapp: '0321 5872222' },
  account_type_parent: { id: 'account_type_changed', name: 'Rida Saeed', to: 'parent', supportWhatsapp: '0321 5872222' },
  account_erased: { id: 'account_erased', supportWhatsapp: '0321 5872222' },
  tuition_paused: { id: 'tuition_paused', title: 'Home Tutor Required | Grade 5 | DHA | Lahore', href: '/tuitions/lahore/sample-1a2b3c' },
  refund_recorded: { id: 'refund_recorded', amountPkr: 199, method: 'JazzCash', whenDate: '28 Oct 2026' },
  document_rejected_tutor: { id: 'verification_rejected', name: 'Rida Saeed', what: 'selfie', reason: 'Your face is not clear.', href: '/tutor/dashboard/settings#identity' },
  document_rejected_parent: { id: 'verification_rejected', name: 'Sana Ahmed', what: 'CNIC', reason: 'The photo is not clear.', href: '/parent/verify', audience: 'parent' },
  document_approved_tutor: { id: 'document_approved', what: 'selfie', href: '/tutor/dashboard' },
  document_approved_parent: { id: 'document_approved', what: 'CNIC', href: '/parent/verify', audience: 'parent' },
  tuition_match: { id: 'tuition_match', subject: 'Grade 5 Mathematics', city: 'Lahore', area: 'DHA', mode: 'Home Tutor', href: '/tuitions/lahore/sample-1a2b3c', unsubscribeHref: 'https://www.tutormint.org/api/notifications/unsubscribe?t=sample' },
}

export const EMAIL_VARIANTS = Object.keys(EMAIL_SAMPLE_INPUTS) as EmailVariant[]
