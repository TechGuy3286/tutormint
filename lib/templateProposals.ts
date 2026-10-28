// lib/templateProposals.ts
//
// PURE, client-safe. The simple-English rewrite of every member-facing
// template (owner, 28 Oct 2026). NOTHING here goes live by itself: each
// wording is a PROPOSED version shown beside the live one in Team inbox →
// Templates → Review new wording, and only the Owner's Approve (or "Edit then
// approve") copies it into the live template. "Keep current" leaves the live
// one as it is. The old wording is kept in template_history with Restore.
//
// The writing rules (checkWording, unit-tested in scripts/test-template-rewrite.ts):
//   - simple English; never "dashboard", "onboarding", "listing", "verification
//     flow" or "ref";
//   - greet by first name; at most 3 short lines before the link (Urdu, when a
//     template has it, is left exactly as it is and does not count);
//   - one action, one link, the link last and alone on its line;
//   - then "Need help? WhatsApp {support_whatsapp}" (the support.whatsapp setting);
//   - no emoji; no price (except the private "About the Verification Fee"
//     reply); no superlative;
//   - only placeholders every send path of that template fills.
//
// WhatsApp / Team-inbox templates live here; the emails live in
// lib/notify/emailWordingCore.ts and share the same checker.

import { LIVE_URDU } from '@/lib/templateUrdu'
import { EMAIL_PROPOSALS } from '@/lib/notify/emailWordingCore'

export type ProposalKind = 'whatsapp' | 'team' | 'email'
export type ProposalRecipient = 'parent' | 'tutor' | 'member'

export type Proposal = {
  /** admin_message_templates.key, or "email:<variant>" for an email. */
  key: string
  kind: ProposalKind
  title: string
  recipient: ProposalRecipient
  /** Emails only (WhatsApp templates keep their stored subject). */
  subject?: string
  /** Emails only: the button the {link} line becomes. */
  button?: string
  body: string
  /** Every placeholder every send path of this template fills. */
  allowed: readonly string[]
  /** The placeholders that may be its one link. */
  links: readonly string[]
  /** The one action is something other than a link (a reply, an email to open). */
  noLink?: boolean
  /** The recipient's name is not known on this path (a stranger's request). */
  noName?: boolean
  /** States the price on purpose (the private fee reply). */
  priceExpected?: boolean
  /** A private receipt: the amount is a placeholder filled at send time. */
  receipt?: boolean
}

export const SUPPORT_LINE = 'Need help? WhatsApp {support_whatsapp}'
const S = `\n\n${SUPPORT_LINE}`

// The placeholders each send path fills (after lib/templateFill completeCommon).
const COMMON = ['first_name', 'support_whatsapp'] as const
const APP = ['parent_name', 'tutor_name', 'tutor_first_name', 'tm_number', 'tuition_title', 'city', 'profile_link', 'open_tuitions_link', 'dashboard_link', 'support_whatsapp'] as const
const APP_UPDATE = ['tutor_name', 'tutor_first_name', 'city', 'applications_list', 'open_tuitions_link', 'dashboard_link', 'support_whatsapp'] as const
const FU = ['name', 'first_name', 'completion', 'next_step', 'continue_link', 'pay_link', 'document', 'reason', 'support_whatsapp'] as const
const PF = ['first_name', 'tuition_title', 'tuition_link', 'post_link', 'tutor_name', 'review_link', 'tutor_links', 'signin_link', 'repost_link', 'support_whatsapp'] as const
/** The Team inbox compose box and the Follow-ups → Signups box. */
const TEAM = ['name', 'first_name', 'job_title', 'reason', 'link', 'continue_link', 'pay_link', 'support_whatsapp'] as const
/** My sign-ups (lib/followUpCore followUpText). */
const MY = ['name', 'first_name', 'link', 'continue_link', 'missing', 'still_to_do', 'step', 'stopped_at', 'support_whatsapp'] as const
const both = (a: readonly string[], b: readonly string[]) => a.filter((x) => b.includes(x))

const hi = (p: string) => `Assalam o Alaikum {${p}},`

function wa(
  key: string,
  title: string,
  recipient: ProposalRecipient,
  lines: string[],
  link: string | null,
  allowed: readonly string[],
  extra: Partial<Proposal> = {},
): Proposal {
  const head = lines.join('\n')
  const body = link ? `${head}\n{${link}}${S}` : `${head}${S}`
  return { key, kind: 'whatsapp', title, recipient, body, allowed, links: link ? [link] : [], noLink: !link, ...extra }
}

/** A template with an Urdu part: English lines, the Urdu exactly as live, then the link and support line. */
function withUrdu(key: string, lines: string[], link: string | null): string {
  const urdu = LIVE_URDU[key]
  if (!urdu) throw new Error(`No live Urdu for ${key}`)
  return `${lines.join('\n')}\n\n${urdu}\n\n${link ? `{${link}}${S}` : SUPPORT_LINE}`
}

export const WHATSAPP_PROPOSALS: readonly Proposal[] = [
  // ------------------------------------------------ Applications (parents)
  wa('app_applied', 'Applications — Applied (share the profile)', 'parent', [
    hi('parent_name'),
    '{tutor_name} has applied to your tuition {tm_number}.',
    'You can see their profile and message them here:',
  ], 'profile_link', APP),
  wa('app_forwarded', 'Applications — Forwarded (did you contact them?)', 'parent', [
    hi('parent_name'),
    'Did you get a chance to talk to {tutor_name} about tuition {tm_number}?',
    'You can message them from their profile:',
  ], 'profile_link', APP),
  wa('app_contacted', 'Applications — Contacted (demo or interview?)', 'parent', [
    hi('parent_name'),
    'A demo lesson helps you decide if {tutor_name} is right for tuition {tm_number}.',
    'You can ask for one on their profile:',
  ], 'profile_link', APP),
  wa('app_demo', 'Applications — Demo/interview (how did it go?)', 'parent', [
    hi('parent_name'),
    'We hope the demo with {tutor_name} went well.',
    'If you would like to go ahead, you can message them on their profile:',
  ], 'profile_link', APP),
  // ------------------------------------------------ Applications (tutors)
  wa('app_hired', 'Applications — Hired (congratulations)', 'tutor', [
    hi('tutor_first_name'),
    'Congratulations on getting tuition {tm_number}!',
    'Please reply with one line about your experience, and we may share it as a success story.',
  ], null, APP),
  wa('app_not_selected', 'Applications — Not selected (kind update)', 'tutor', [
    hi('tutor_first_name'),
    'The parent chose another tutor for tuition {tm_number}. New tuitions are posted every day.',
    'You can see the open ones in your city here:',
  ], 'open_tuitions_link', APP),
  wa('app_no_response', 'Applications — No response (kind update)', 'tutor', [
    hi('tutor_first_name'),
    'The parent of tuition {tm_number} has not replied to us. New tuitions are posted every day.',
    'You can see the open ones in your city here:',
  ], 'open_tuitions_link', APP),
  wa('app_tutor_update', 'Applications — By tutor (check-in)', 'tutor', [
    `${hi('tutor_first_name')} here is where your tuition applications stand:`,
    '{applications_list}',
    'You can see them all here:',
  ], 'dashboard_link', APP_UPDATE),
  wa('applicants_forward', 'Applicants to forward', 'parent', [
    hi('parent_name'),
    'These tutors are interested in your tuition {tuition_title}.',
    'Open a profile to message the tutor:',
  ], 'tutor_list', ['parent_name', 'tuition_title', 'area', 'tutor_list', 'support_whatsapp']),

  // ------------------------------------------------ Follow-ups → Tutors
  wa('fu_reupload', 'Follow-ups — document to upload again', 'tutor', [
    hi('first_name'),
    'We could not approve your {document}. {reason}',
    'Please upload it again here:',
  ], 'continue_link', FU),
  wa('payment_not_finished', "Started payment, didn't finish", 'tutor', [
    hi('first_name'),
    'Your TutorMint payment did not go through.',
    'You can try again here:',
  ], 'pay_link', both(FU, ['name', 'first_name', 'pay_link', 'support_whatsapp'])),
  {
    key: 'fee_not_paid',
    kind: 'whatsapp',
    title: 'One step left to get verified',
    recipient: 'tutor',
    body: withUrdu('fee_not_paid', [hi('first_name'), 'One step left: pay the one-time Verification Fee to get your Verified badge.'], 'pay_link'),
    allowed: both(FU, TEAM),
    links: ['pay_link'],
  },
  wa('signup_mobile_unverified', 'Signup — mobile not verified', 'tutor', [
    hi('first_name'),
    'To finish signing up, enter the code we sent to your mobile by SMS.',
    'You can enter it here:',
  ], 'continue_link', both(both(FU, MY), TEAM)),
  wa('fu_no_cnic', 'Follow-ups — CNIC not added', 'tutor', [
    hi('first_name'),
    'Your next step is to add your CNIC, both sides. Only our team sees it.',
    'You can add it here:',
  ], 'continue_link', FU),
  wa('fu_no_photo', 'Follow-ups — photo or selfie not added', 'tutor', [
    hi('first_name'),
    'Your next step is to {next_step}.',
    'You can do it here:',
  ], 'continue_link', FU),
  wa('fu_paid_unfinished', 'Follow-ups — paid, profile not finished', 'tutor', [
    hi('first_name'),
    'Thank you for getting verified. Your next step is to {next_step}.',
    'You can do it here:',
  ], 'continue_link', FU),
  wa('profile_completion_nudge', 'Finish your profile', 'tutor', [
    hi('first_name'),
    'Your profile is not finished yet, so parents cannot find you.',
    'You can finish it here:',
  ], 'continue_link', both(both(FU, MY), TEAM)),
  wa('fu_fee_reply', 'About the Verification Fee', 'tutor', [
    hi('first_name'),
    'Joining TutorMint is free, with no commission. To apply to tuitions, you pay a one-time Verification Fee of Rs 199.',
    'You can pay here:',
  ], 'pay_link', FU, { priceExpected: true }),

  // ------------------------------------------------ Documents and status image
  wa('documents_approved', 'Documents approved — fee not paid', 'tutor', [
    hi('first_name'),
    'Your documents are approved. One step left: pay the Verification Fee to get your Verified badge.',
    'You can pay here:',
  ], 'pay_link', ['name', 'pay_link', 'profile_link', ...COMMON]),
  wa('documents_approved_paid', 'Documents approved — profile live', 'tutor', [
    hi('first_name'),
    'Your documents are approved, and parents can now see your profile.',
    'You can see it here:',
  ], 'profile_link', ['name', 'pay_link', 'profile_link', ...COMMON]),
  wa('status_image_verified', 'Status image — you are a Verified Tutor', 'tutor', [
    hi('tutor_first_name'),
    'Congratulations, you are now a Verified Tutor on TutorMint.',
    'Please post the attached picture on your WhatsApp status.',
  ], null, ['tutor_first_name', 'support_whatsapp']),

  // ------------------------------------------------ My sign-ups
  wa('my_signup_upload_documents', 'My sign-ups — upload documents', 'tutor', [
    hi('first_name'),
    'Please upload your CNIC, profile photo and selfie so we can check your profile.',
    'You can upload them here:',
  ], 'link', MY),
  wa('my_signup_pay_fee', 'My sign-ups — pay the Verification Fee', 'tutor', [
    hi('first_name'),
    'Your profile is ready. The last step is the Verification Fee, which gets you the Verified badge.',
    'You can pay here:',
  ], 'link', MY),
  wa('my_signup_post_tuition', 'My sign-ups — post a tuition', 'parent', [
    hi('first_name'),
    'Post your tuition for free, and verified tutors near you can apply.',
    'You can post it yourself here:',
  ], 'link', MY),
  wa('my_signup_buy_plan', 'My sign-ups — buy a plan', 'parent', [
    hi('first_name'),
    "Thank you for posting your tuition. With a plan you can see tutors' numbers and hire directly.",
    'You can see the plans here:',
  ], 'link', MY),
  wa('my_signup_check_in', 'My sign-ups — check in', 'member', [
    hi('first_name'),
    'Thank you for joining TutorMint. We are here if you need anything.',
    'You can find quick answers here:',
  ], 'link', MY),

  // ------------------------------------------------ Follow-ups → Parents
  wa('pf_tutors_applied', 'Parents — tutors applied, here they are', 'parent', [
    hi('first_name'),
    'Tutors have applied to your tuition. Open a profile to see the tutor and message them:',
  ], 'tutor_links', PF),
  wa('pf_no_tuition', 'Parents — signed up, no tuition posted', 'parent', [
    hi('first_name'),
    'Post your tuition for free, and verified tutors near you can apply.',
    'You can post it yourself here:',
  ], 'post_link', PF),
  wa('pf_no_applicants', 'Parents — tuition posted, no applicants', 'parent', [
    hi('first_name'),
    'No tutor has applied to your tuition yet. Adding the timings and a few details helps tutors decide.',
    'You can see it here:',
  ], 'tuition_link', PF),
  wa('pf_email_unconfirmed', 'Parents — email not confirmed', 'parent', [
    hi('first_name'),
    'Thank you for signing up. Post your tuition for free, and verified tutors can apply.',
    'You can post it yourself here:',
  ], 'post_link', PF),
  wa('pf_expired', 'Parents — tuition ended, still looking?', 'parent', [
    hi('first_name'),
    'Your tuition is no longer live. Still looking for a tutor?',
    'You can post it again for free here:',
  ], 'post_link', PF),
  wa('pf_hired', 'Parents — tutor hired, thanks', 'parent', [
    hi('first_name'),
    'Thank you for choosing {tutor_name}. A short review helps other parents.',
    'You can leave it here:',
  ], 'review_link', PF),
  wa('seeded_tuition_live', 'Seeded tuition — live', 'parent', [
    hi('first_name'),
    'Your tuition is now on TutorMint, and verified tutors can apply.',
    'You can see it here:',
  ], 'tuition_url', ['name', 'tuition_url', 'join_link', ...COMMON]),

  // ------------------------------------------------ Team inbox (in-app + email, or WhatsApp)
  team('address_untraceable', 'Address could not be verified', 'member', [
    hi('first_name'),
    'We could not check the address on your account. Please make sure it is complete and correct.',
    'You can update it here:',
  ], 'link'),
  team('cnic_unclear', 'CNIC photo unclear', 'member', [
    hi('first_name'),
    'The photo of your CNIC is not clear enough to read. Please upload a clear photo of both sides.',
    'You can upload it here:',
  ], 'link'),
  team('job_under_review', 'Your tuition is under review', 'parent', [
    hi('first_name'),
    'Your tuition "{job_title}" is paused for a short check after a report.',
    'Nothing is lost, and we will message you as soon as the check is done.',
  ], null),
  team('video_rerecord', 'Please re-record your video', 'tutor', [
    hi('first_name'),
    'Please record your introduction video again. Reason: {reason}',
    'You can upload the new video here:',
  ], 'link'),
  team('payment_received', 'Payment received', 'member', [
    hi('first_name'),
    'We have received your payment. Our team will check it, usually within a few hours.',
    'We will message you as soon as it is approved.',
  ], null),
  team('payment_approved', 'Payment approved', 'member', [
    hi('first_name'),
    'Your payment is approved and your plan is now active. Thank you.',
    'You can start using it here:',
  ], 'link'),
  {
    key: 'awaiting_approval',
    kind: 'team',
    title: 'Your documents are being reviewed',
    recipient: 'tutor',
    body: withUrdu('awaiting_approval', [hi('first_name'), 'Thank you for sending your documents. We are checking them and will message you when it is done.'], null),
    allowed: TEAM,
    links: [],
    noLink: true,
  },
  {
    key: 'no_whatsapp',
    kind: 'team',
    title: 'Add your WhatsApp number',
    recipient: 'tutor',
    body: withUrdu('no_whatsapp', [hi('first_name'), 'Parents contact tutors on WhatsApp. Please add your WhatsApp number so they can reach you.'], 'link'),
    allowed: TEAM,
    links: ['link'],
  },
  team('signup_email_unconfirmed', 'Signup — email not confirmed', 'member', [
    hi('first_name'),
    'Please confirm your email by tapping the link in the email we sent you. If it is not there, check your spam folder.',
  ], null),
  team('signup_profile_unfinished', 'Signup — profile unfinished', 'member', [
    hi('first_name'),
    'You are almost set up on TutorMint. It only takes a few minutes.',
    'You can carry on here:',
  ], 'link'),
]

function team(key: string, title: string, recipient: ProposalRecipient, lines: string[], link: string | null): Proposal {
  return { ...wa(key, title, recipient, lines, link, TEAM), kind: 'team' }
}

/** Every proposal, WhatsApp and Team inbox first, then the emails. */
export const ALL_PROPOSALS: readonly Proposal[] = [...WHATSAPP_PROPOSALS, ...EMAIL_PROPOSALS]

export function proposalFor(key: string): Proposal | null {
  return ALL_PROPOSALS.find((p) => p.key === key) ?? null
}

/** Not rewritten, and why (shown on the review page). */
export const NOT_REWRITTEN: readonly { key: string; why: string }[] = [
  { key: 'city_hiring_post', why: 'A public hiring post staff share on social media, not a message to a member.' },
  { key: 'consent_ask', why: 'Switched off since 27 Oct 2026 (consent is not needed).' },
]

// ------------------------------------------------------------- the rules

const TOKEN = /\{([a-z_]+)\}/g
const ARABIC = /[؀-ۿ]/
const EMOJI = /\p{Extended_Pictographic}|[☀-➿]|️/u
export const JARGON = /\b(dashboard|onboarding|listing|listings|verification flow|ref)\b/i
const PRICE = /\b(rs\.?|pkr|rupees?)(?=[\s\d.,:]|$)|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\s*(?:\/-|k\b)/i
const SUPERLATIVE = /\b(largest|biggest|best|top|no\.?\s?1|number one|leading|most trusted)\b|#1/i
const URL = /https?:\/\/|www\./i
const GREETING = /^(Assalam o Alaikum|Hi|Hello)\b/
const NAME_TOKENS = ['first_name', 'parent_name', 'tutor_first_name', 'name']
/** A line this long (placeholders not counted) is not "short". */
export const MAX_LINE = 140

const tokensIn = (s: string) => [...s.matchAll(TOKEN)].map((m) => m[1])
const plainText = (s: string) => s.replace(TOKEN, ' ')

/** The English part: everything before an Urdu separator. */
function englishPart(body: string): string {
  const i = body.indexOf('— — —')
  return i < 0 ? body : body.slice(0, i)
}

/** Lines that carry Arabic-script text, in order. */
export function urduLines(body: string): string[] {
  return body.split('\n').filter((l) => ARABIC.test(l))
}

/**
 * Every rule a proposed wording must follow. Returns the problems in words
 * (empty = follows the rules). `liveBody` is the current live text, when known,
 * for the "Urdu unchanged" rule.
 */
export function checkWording(p: Pick<Proposal, 'kind' | 'body' | 'subject' | 'button' | 'allowed' | 'links' | 'noLink' | 'noName' | 'priceExpected'>, liveBody?: string | null): string[] {
  const problems: string[] = []
  const body = p.body.replace(/\r\n/g, '\n').trim()
  const lines = body.split('\n')
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  const english = englishPart(body)
  const textAll = [body, p.subject ?? '', p.button ?? ''].join('\n')

  // Placeholders.
  const unknown = [...new Set(tokensIn(textAll).filter((t) => !p.allowed.includes(t)))]
  if (unknown.length) problems.push(`Uses placeholders this template's send paths do not fill: ${unknown.map((u) => `{${u}}`).join(', ')}.`)

  // Emoji (WhatsApp and Team messages; emails are held to it too).
  if (EMOJI.test(textAll)) problems.push('Has an emoji.')

  // Jargon, price, superlative — on the words, not the placeholders.
  const words = plainText(textAll.replace(/https?:\/\/\S+/g, ' '))
  const jargon = words.match(JARGON)
  if (jargon) problems.push(`Uses the word "${jargon[0]}".`)
  if (!p.priceExpected && PRICE.test(words)) problems.push('Mentions a price.')
  if (SUPERLATIVE.test(words)) problems.push('Uses a word like "best" or "top".')
  if (URL.test(textAll)) problems.push('Has a web address written in; use the link placeholder.')

  // Greeting.
  const first = nonEmpty[0] ?? ''
  if (!GREETING.test(first)) problems.push('Does not start with a greeting.')
  if (!p.noName && !NAME_TOKENS.some((t) => first.includes(`{${t}}`))) problems.push('Does not greet the person by first name.')

  // Support line, last.
  if (nonEmpty[nonEmpty.length - 1] !== SUPPORT_LINE) problems.push(`Does not end with "${SUPPORT_LINE}".`)

  // The one link, last, alone on its line.
  const linkTokens = tokensIn(body).filter((t) => p.links.includes(t))
  const linkLines = lines.map((l, i) => ({ l: l.trim(), i })).filter(({ l }) => p.links.some((k) => l.includes(`{${k}}`)))
  if (p.noLink) {
    if (linkTokens.length) problems.push('Has a link, but its one action is not a link.')
  } else {
    if (linkTokens.length !== 1) problems.push(`Has ${linkTokens.length} links; it must have exactly one.`)
    const ll = linkLines[0]
    if (ll && !p.links.some((k) => ll.l === `{${k}}`)) problems.push('The link is not alone on its own line.')
    if (ll) {
      const after = lines.slice(ll.i + 1).map((l) => l.trim()).filter(Boolean)
      if (after.length !== 1 || after[0] !== SUPPORT_LINE) problems.push('The link is not last (only the support line may follow it).')
    }
  }

  // At most 3 short lines before the link (the English part only).
  const englishLines = english.split('\n').map((l) => l.trim()).filter(Boolean)
  const before = p.noLink || !linkLines[0]
    ? englishLines.filter((l) => l !== SUPPORT_LINE)
    : englishLines.slice(0, englishLines.findIndex((l) => p.links.some((k) => l.includes(`{${k}}`))) >>> 0)
  const counted = before.filter((l) => !p.links.some((k) => l === `{${k}}`))
  if (counted.length > 3) problems.push(`Has ${counted.length} lines before the link; at most 3.`)
  for (const l of counted) if (plainText(l).trim().length > MAX_LINE) problems.push(`A line is too long: "${l.slice(0, 40)}…".`)

  // Urdu unchanged.
  if (liveBody != null) {
    const a = urduLines(liveBody)
    const b = urduLines(body)
    if (a.join('\n') !== b.join('\n')) problems.push('The Urdu text is not exactly the same as the live template.')
  }

  // One action: never two different asks ("reply" with a link is two).
  if (!p.noLink && /\breply\b/i.test(plainText(english))) problems.push('Asks for a reply and has a link — one action only.')

  return problems
}

// ------------------------------------------------------------- preview

/** Sample values for every placeholder any template uses (no real person). */
export const PREVIEW_SAMPLE: Record<string, string> = {
  name: 'Sana',
  first_name: 'Sana',
  parent_name: 'Sana',
  tutor_name: 'Rida Saeed',
  tutor_first_name: 'Rida',
  tm_number: 'TM-1303',
  tuition_title: 'Home Tutor Required | Grade 5 | DHA | Lahore',
  job_title: 'Home Tutor Required | Grade 5 | DHA | Lahore',
  city: 'Lahore',
  area: 'DHA',
  completion: '60',
  next_step: 'add your profile photo',
  document: 'selfie',
  reason: 'Reason: face not clear.',
  missing: 'profile photo, selfie',
  still_to_do: 'profile photo, selfie',
  step: 'Photo',
  stopped_at: 'Photo',
  applications_list: '• TM-1303 — Home Tutor Required: Shared with the parent\n• TM-1288 — Online Tutor Required: Application received',
  tutor_list: 'Rida Saeed: https://www.tutormint.org/tutor/rida-saeed-tutor',
  tutor_links: 'https://www.tutormint.org/tutor/rida-saeed-tutor',
  profile_link: 'https://www.tutormint.org/tutor/rida-saeed-tutor',
  open_tuitions_link: 'https://www.tutormint.org/browse/tuitions?city=Lahore',
  dashboard_link: 'https://www.tutormint.org/tutor/dashboard',
  continue_link: 'https://www.tutormint.org/tutor/dashboard',
  pay_link: 'https://www.tutormint.org/pay/choose?plan=verified',
  link: 'https://www.tutormint.org/post-tuition',
  post_link: 'https://www.tutormint.org/post-tuition',
  tuition_link: 'https://www.tutormint.org/tuitions/lahore/sample-tuition-1a2b3c',
  tuition_url: 'https://www.tutormint.org/tuitions/lahore/sample-tuition-1a2b3c',
  review_link: 'https://www.tutormint.org/review',
  signin_link: 'https://www.tutormint.org/login',
  repost_link: 'https://www.tutormint.org/post-tuition',
  join_link: 'https://www.tutormint.org/register',
  // Email placeholders.
  plan: 'Premium',
  amount: 'Rs 499',
  until: '28 Nov 2026',
  days: '3',
  unlocks: 'You can now see parents’ numbers and message them on WhatsApp.',
  badge_note: '',
  count_text: '2 new messages',
  from_text: ' from Rida Saeed',
  tuition: 'Home Tutor Required | Grade 5 (TM-1303)',
  search: 'Maths tutor in Lahore',
  method: 'JazzCash',
  date: '28 Oct 2026',
  live_days: '20 days',
  note: '',
  subject: 'Grade 5 Mathematics',
  where: 'DHA, Lahore',
  mode_text: ' (Home Tutor)',
}

/** The text filled with sample data, the way a member would read it. */
export function previewText(body: string, support: string): string {
  return body
    .replace(TOKEN, (m, k: string) => (k === 'support_whatsapp' ? support : (PREVIEW_SAMPLE[k] ?? m)))
    .split('\n')
    .filter((line, i, all) => !(line.trim() === '' && (all[i - 1] ?? '').trim() === ''))
    .join('\n')
}
