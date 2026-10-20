// lib/tutorFollowUpCore.ts
//
// PURE, client-safe. Follow-ups → Tutors as ONE list (owner, 20 Oct 2026).
//
// The Overview lists "Unpaid signups not yet contacted", "Stuck in onboarding"
// and "Started payment, didn't finish" showed the same tutors, so staff could
// message one person twice. They are now chips on the one Follow-ups → Tutors
// list, and each tutor is ONE card:
//
//   started    Started payment     a checkout opened over an hour ago, not
//                                  paid, gone after 48 hours or once paid
//                                  (lib/startedPaymentCore, unchanged)
//   docs_done  Docs done, fee not paid
//                                  CNIC, photo and selfie approved, every
//                                  onboarding step done but the fee
//   stuck      Stuck at a step     an onboarding step (or the email / mobile
//                                  before it) is not done
//   not_contacted                  nobody has contacted them
//   again      Follow up again     last contact 3+ days ago, still not paid
//   contacted  Contacted           contacted (in the last 3 days, or since paid)
//
// A tutor may match several chips; the first of PRIORITY that matches is their
// state on "All", and "All" is sorted by it.
//
// The WhatsApp text is built from the tutor's own state (first name, profile %,
// next step, a rejected document). New plain-English messages; no stored
// template (and no Urdu text) is changed.
//
// Unit-tested by scripts/test-tutor-follow-ups.ts.

import type { FlowStepKey } from '@/lib/tutorFlow'

export const FOLLOW_UP_AGAIN_DAYS = 3
const DAY = 86_400_000

export const FOLLOW_CHIPS = ['started', 'docs_done', 'stuck', 'not_contacted', 'again', 'contacted'] as const
export type FollowChip = (typeof FOLLOW_CHIPS)[number]
/** The order "most urgent first" — also the order the chips are shown in. */
export const PRIORITY: readonly FollowChip[] = FOLLOW_CHIPS

export const FOLLOW_CHIP_LABEL: Record<FollowChip, string> = {
  started: 'Started payment',
  docs_done: 'Docs done, fee not paid',
  stuck: 'Stuck at a step',
  not_contacted: 'Not contacted',
  again: 'Follow up again',
  contacted: 'Contacted',
}

export type ChipFilter = FollowChip | 'all'

export function parseFollowChip(v: string | null | undefined): ChipFilter {
  return (FOLLOW_CHIPS as readonly string[]).includes(v ?? '') ? (v as FollowChip) : 'all'
}

/** Where the tutor stopped: a flow step, or the email / mobile before the flow,
 *  or 'whatsapp' (the contact step with the mobile verified). null = every step
 *  done (the fee may still be due). */
export type FollowStep = FlowStepKey | 'email' | 'mobile' | 'whatsapp'

export type RejectedDoc = { doc: 'cnic' | 'photo' | 'selfie'; reason: string | null }

export type TutorFollowFacts = {
  feePaid: boolean
  /** Profile completion 0–100. */
  completion: number
  stoppedStep: FollowStep | null
  /** CNIC, profile photo and selfie are all approved. */
  docsApproved: boolean
  rejected: RejectedDoc[]
  /** A started-not-finished checkout (lib/startedPaymentCore). */
  startedPayment: { planCode: string | null; startedAt: string } | null
  /** The newest contact of any kind (a follow-up record or a logged call). */
  lastContactAt: string | null
}

const isFeeStep = (s: FollowStep | null) => s === null || s === 'verify'

/** Every chip this tutor matches. */
export function chipsFor(f: TutorFollowFacts, nowMs: number): Set<FollowChip> {
  const out = new Set<FollowChip>()
  if (f.startedPayment) out.add('started')
  if (!f.feePaid && f.docsApproved && isFeeStep(f.stoppedStep)) out.add('docs_done')
  if (!isFeeStep(f.stoppedStep)) out.add('stuck')
  if (!f.lastContactAt) out.add('not_contacted')
  else {
    const age = nowMs - Date.parse(f.lastContactAt)
    if (!f.feePaid && age >= FOLLOW_UP_AGAIN_DAYS * DAY) out.add('again')
    else out.add('contacted')
  }
  return out
}

/** The most urgent chip — the tutor's state on "All". */
export function primaryChip(chips: Set<FollowChip>): FollowChip {
  return PRIORITY.find((c) => chips.has(c)) ?? 'contacted'
}

export function chipRank(c: FollowChip): number {
  return PRIORITY.indexOf(c)
}

/** Count per chip (a tutor counts in every chip they match) and the total. */
export function chipCounts(rows: { chips: Set<FollowChip> }[]): Record<ChipFilter, number> {
  const out = { all: rows.length } as Record<ChipFilter, number>
  for (const c of FOLLOW_CHIPS) out[c] = rows.filter((r) => r.chips.has(c)).length
  return out
}

/** The rows of a chip; "All" = everyone once, most urgent first (stable). */
export function rowsForChip<T extends { chips: Set<FollowChip>; primary: FollowChip }>(rows: T[], chip: ChipFilter): T[] {
  if (chip !== 'all') return rows.filter((r) => r.chips.has(chip))
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => chipRank(a.r.primary) - chipRank(b.r.primary) || a.i - b.i)
    .map((x) => x.r)
}

// ----------------------------------------------------------- next step

/** The short card label: "Next: CNIC photos". */
export const NEXT_LABEL: Record<FollowStep, string> = {
  email: 'Confirm email',
  mobile: 'Verify mobile',
  whatsapp: 'WhatsApp number',
  name: 'Name',
  gender: 'Gender',
  city: 'Where they teach',
  area: 'Where they teach',
  level: 'Subjects',
  subjects: 'Subjects',
  jobtype: 'Job type',
  fee: 'Monthly fee',
  experience: 'Experience',
  degree: 'Education',
  availability: 'Availability',
  contact: 'Verify mobile',
  photo: 'Profile photo',
  selfie: 'Selfie',
  cnic_number: 'CNIC number',
  cnic_photos: 'CNIC photos',
  tagline: 'Tagline and bio',
  verify: 'Verification Fee',
}

/** The next step as words in a message: "add your CNIC photos". */
export const NEXT_PHRASE: Record<FollowStep, string> = {
  email: 'confirm your email address',
  mobile: 'verify your mobile number',
  contact: 'verify your mobile number',
  whatsapp: 'add your WhatsApp number',
  name: 'add your name',
  gender: 'choose your gender',
  city: 'choose where you teach',
  area: 'choose where you teach',
  level: 'choose your subjects',
  subjects: 'choose your subjects',
  jobtype: 'choose the work you want',
  fee: 'set your monthly fee',
  experience: 'add your years of experience',
  degree: 'add your education',
  availability: 'choose when you can teach',
  photo: 'add your profile photo',
  selfie: 'take your selfie',
  cnic_number: 'enter your CNIC number',
  cnic_photos: 'add your CNIC photos',
  tagline: 'write your tagline and bio',
  verify: 'pay the one-time Rs 199 Verification Fee',
}

export function nextLabel(f: Pick<TutorFollowFacts, 'stoppedStep' | 'feePaid'>): string | null {
  if (f.stoppedStep) return NEXT_LABEL[f.stoppedStep]
  return f.feePaid ? null : NEXT_LABEL.verify
}

export function nextPhrase(f: Pick<TutorFollowFacts, 'stoppedStep' | 'feePaid'>): string {
  if (f.stoppedStep) return NEXT_PHRASE[f.stoppedStep]
  return f.feePaid ? 'finish your profile' : NEXT_PHRASE.verify
}

// ------------------------------------------------------------- messages

export type MessageType = 'next_step' | 'fee_due' | 'payment_unfinished' | 'payment_unfinished_plan'

export const DOC_WORD: Record<RejectedDoc['doc'], string> = { cnic: 'CNIC photos', photo: 'profile photo', selfie: 'selfie' }

export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Please re-upload your selfie first (face not clear)." — or null. */
export function reuploadLine(rejected: RejectedDoc[]): string | null {
  if (rejected.length === 0) return null
  const docs = joinAnd([...new Set(rejected.map((r) => DOC_WORD[r.doc]))])
  const reasons = [...new Set(rejected.map((r) => (r.reason ?? '').trim().replace(/[.\s]+$/, '')).filter(Boolean))]
  return `Please re-upload your ${docs} first${reasons.length ? ` (${reasons.join('; ')})` : ''}.`
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}

/** The stored follow-up record's template key for a message type. */
export function messageTemplateKey(type: MessageType, reupload: boolean): string {
  return `followup_${reupload ? 'reupload_' : ''}${type}`
}

/**
 * The WhatsApp text for one tutor, chosen by their most urgent state. A
 * checkout for something other than the Verification Fee (a plan) gets the
 * stored payment_not_finished text (`planMessage`, already filled) — the
 * Rs 199 wording would be untrue for it.
 */
export function followUpMessage(
  f: TutorFollowFacts,
  name: string,
  nowMs: number,
  planMessage?: string | null,
): { text: string; type: MessageType; templateKey: string } {
  const first = firstNameOf(name)
  const primary = primaryChip(chipsFor(f, nowMs))
  let type: MessageType
  let body: string
  if (primary === 'started' && f.startedPayment && f.startedPayment.planCode !== 'verified' && f.startedPayment.planCode) {
    type = 'payment_unfinished_plan'
    body =
      planMessage?.trim() ||
      `Assalam o Alaikum ${first}, your TutorMint payment didn't complete. You can try again here: tutormint.org/membership-plans. Reply here if you need help. 🙂`
  } else if (primary === 'started') {
    type = 'payment_unfinished'
    body = `Assalam o Alaikum ${first}, you started your Rs 199 Verification Fee but it didn't complete. You can finish it here: tutormint.org/pay/choose. If JazzCash gave a problem, choose 'Other methods' to pay from any bank app or Easypaisa. Reply here if you need help. 🙂`
  } else if (primary === 'docs_done') {
    type = 'fee_due'
    body = `Assalam o Alaikum ${first}, your documents are approved ✅. The last step is the one-time Rs 199 Verification Fee: tutormint.org/pay/choose. After that you get the Verified badge and can apply to tuitions. Reply here if you need help. 🙂`
  } else {
    type = 'next_step'
    const pct = Math.max(0, Math.min(100, Math.round(f.completion || 0)))
    body = `Assalam o Alaikum ${first}, your TutorMint profile is ${pct}% complete. The next step is ${nextPhrase(f)}. You can continue here: tutormint.org/tutor/dashboard. If you need any help, just reply here. 🙂`
  }
  const lead = reuploadLine(f.rejected)
  return { text: lead ? `${lead}\n\n${body}` : body, type, templateKey: messageTemplateKey(type, !!lead) }
}

/** "Contacted 18 Oct 2026 by Aqsa". `dateText` is already formatted. */
export function contactedLine(dateText: string | null, by: string | null): string | null {
  if (!dateText) return null
  return `Contacted ${dateText} by ${by || 'staff'}`
}

/** "Started 19 Oct 2026, 3:10 pm · Verification Fee · PayPro". */
export function startedLine(dateText: string, planName: string, provider: string | null): string {
  const via = provider === 'paypro' ? 'PayPro' : provider === 'manual' ? 'Bank transfer page' : provider || 'Online'
  return `Started ${dateText} · ${planName} · ${via}`
}

// ------------------------------------------------------- old addresses

export const FOLLOW_UPS_TUTORS = '/admin/follow-ups'

/** The new Follow-ups address for a chip. */
export function chipHref(chip: ChipFilter, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  if (chip !== 'all') q.set('chip', chip)
  const s = q.toString()
  return s ? `${FOLLOW_UPS_TUTORS}?${s}` : FOLLOW_UPS_TUTORS
}

/** The Overview lists that were merged → their chip. */
export const OVERVIEW_KEY_CHIP: Record<string, FollowChip> = {
  'todo-uncontacted': 'not_contacted',
  'todo-stuck': 'stuck',
  'todo-stuck-sent': 'contacted',
  'todo-payments': 'started',
}

/** Old Follow-ups ?filter= values → their chip. */
export const LEGACY_FILTER_CHIP: Record<string, FollowChip> = {
  uncontacted: 'not_contacted',
  onboarding: 'stuck',
  payment: 'docs_done',
  followed: 'contacted',
  started_payment: 'started',
}

/**
 * Where an old Follow-ups query now goes, or null when it is already current.
 * `?filter=onboarding` → `?chip=stuck`; `?scope=started_payment` → the default
 * group, chip Started payment. Other params (scope, q, sign-up day) are kept.
 */
export function legacyFollowUpsRedirect(sp: Record<string, string | undefined>): string | null {
  const legacyChip = sp.filter ? LEGACY_FILTER_CHIP[sp.filter] : undefined
  const startedScope = sp.scope === 'started_payment'
  if (!legacyChip && !startedScope) return null
  const keep: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'chip') continue
    if (k === 'filter' && legacyChip) continue
    if (k === 'scope' && startedScope) continue
    keep[k] = v
  }
  const chip = legacyChip ?? (startedScope ? 'started' : parseFollowChip(sp.chip))
  return chipHref(chip, keep)
}

/** A payment-status check's answer, in words. */
export type PaymentCheckOutcome =
  | { state: 'paid'; message: string }
  | { state: 'not_paid'; message: string }
  | { state: 'mismatch'; message: string }
  | { state: 'unreachable'; message: string }

export function paymentCheckOutcome(
  r: { activated: boolean; alreadyActive: boolean; accepted: boolean; ggosOk: boolean; reason?: string },
  checkedText: string,
): PaymentCheckOutcome {
  if (r.alreadyActive || (r.accepted && r.activated)) return { state: 'paid', message: 'Paid ✅' }
  if (!r.ggosOk) return { state: 'unreachable', message: 'PayPro could not be reached. Try again in a few minutes.' }
  if (r.accepted && !r.activated) return { state: 'unreachable', message: 'PayPro says paid, but activation did not finish. Try again.' }
  if (r.reason === 'not_paid') return { state: 'not_paid', message: `Not paid yet (checked ${checkedText})` }
  return { state: 'mismatch', message: `PayPro's record does not match this order (checked ${checkedText}). Look at it on Payments.` }
}

/** From the card statuses (lib/tutorDocQueueCore): all three approved, and the
 *  rejected ones with their reasons. A Pending re-upload of an approved item
 *  counts as approved for the fee message — the approval still stands. */
export function docFactsFrom(
  s: { cnic: DocLike; profilePic: DocLike; selfie: DocLike } | null | undefined,
): { docsApproved: boolean; rejected: RejectedDoc[] } {
  if (!s) return { docsApproved: false, rejected: [] }
  const items: [RejectedDoc['doc'], DocLike][] = [
    ['cnic', s.cnic],
    ['photo', s.profilePic],
    ['selfie', s.selfie],
  ]
  const ok = (d: DocLike) => d.status === 'approved' || (d.status === 'pending' && !!d.rereview)
  return {
    docsApproved: items.every(([, d]) => ok(d)),
    rejected: items.filter(([, d]) => d.status === 'rejected').map(([doc, d]) => ({ doc, reason: d.reason ?? null })),
  }
}
type DocLike = { status: string; reason?: string | null; rereview?: boolean }

/** The newest of the two contact records (a follow-up and a logged call). */
export function latestContact(
  a: { at: string | null; by: string | null } | null,
  b: { at: string | null; by: string | null } | null,
): { at: string; by: string | null } | null {
  const xs = [a, b].filter((x): x is { at: string; by: string | null } => !!x?.at)
  if (xs.length === 0) return null
  return xs.sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0]
}
