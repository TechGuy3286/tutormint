// What KIND of thing an activity row is, and therefore what colour its disc is.
//
// Four families, and they are the four brand tints the avatar already uses --
// no new colour family is introduced here, and the four fg/bg pairs are the
// ones scripts/contrast-check.ts already asserts. Reusing AVATAR_TINTS' exact
// class strings rather than writing `bg-tm-tint-navy` again by hand is what
// keeps that true: if a tint is ever retuned, both surfaces move together.
//
//   messages    navy    somebody wrote to you
//   money       gold    plans, payments, quotas -- anything with a price
//   progress    green   verification, hires, applications, demos, jobs
//   moderation  red     suspension, warnings, reports, blocks
//
// The colour is a scanning aid and nothing more. It never carries information
// that is not also in the words: a red disc sits beside a sentence that says
// what happened, because a member who does not know the code learns nothing
// from the colour alone.

export type Family = 'messages' | 'money' | 'progress' | 'moderation'

export type FamilyStyle = {
  /** Tailwind classes for the disc: ground plus currentColor for the icon. */
  className: string
  icon: 'message' | 'money' | 'progress' | 'shield'
}

export const FAMILY_STYLE: Record<Family, FamilyStyle> = {
  // These four strings are AVATAR_TINTS' className values, in order.
  messages: { className: 'bg-tm-tint-navy text-tm-navy', icon: 'message' },
  money: { className: 'bg-tm-tint-gold text-tm-gold-ink', icon: 'money' },
  progress: { className: 'bg-tm-tint-green text-tm-green-deep', icon: 'progress' },
  moderation: { className: 'bg-tm-tint-red text-tm-red', icon: 'shield' },
}

const BY_TYPE: Record<string, Family> = {
  // ---------------------------------------------------------- messages ---
  message_received: 'messages',
  message_sent: 'messages',

  // ------------------------------------------------------------- money ---
  plan_purchased: 'money',
  plan_granted: 'money',
  plan_expiring: 'money',
  plan_expired: 'money',
  plan_revoked: 'money',
  plan_activated: 'money',
  payment_submitted: 'money',
  payment_rejected: 'money',
  payment_approved: 'money',

  // -------------------------------------------------------- moderation ---
  suspended: 'moderation',
  unsuspended: 'moderation',
  warned: 'moderation',
  reported: 'moderation',
  report_resolved: 'moderation',
  blocked: 'moderation',
  unblocked: 'moderation',

  // ---------------------------------------------------------- progress ---
  verification_approved: 'progress',
  verification_rejected: 'progress',
  verification_submitted: 'progress',
  verification_decision_received: 'progress',
  hired: 'progress',
  was_hired: 'progress',
  job_posted: 'progress',
  job_edited: 'progress',
  job_closed: 'progress',
  job_filled: 'progress',
  job_matched: 'progress',
  application_received: 'progress',
  application_submitted: 'progress',
  application_withdrawn: 'progress',
  application_shortlisted: 'progress',
  application_rejected: 'progress',
  demo_requested: 'progress',
  demo_accepted: 'progress',
  demo_declined: 'progress',
  demo_completed: 'progress',
  shortlist_added: 'progress',
  shortlist_removed: 'progress',
  video_submitted: 'progress',
  document_uploaded: 'progress',
  profile_claimed: 'progress',
  email_confirmed: 'progress',
}

/**
 * Anything unclassified is 'progress'.
 *
 * Every type this app currently emits is in the table above. The default
 * exists for the one added next month whose author forgets this file: a green
 * disc beside a correct sentence is a small wrong, where a crash or a blank
 * disc would be a visible one.
 */
export function familyFor(type: string): Family {
  return BY_TYPE[type] ?? 'progress'
}

/**
 * How a run of N identical events reads on one card.
 *
 * Written per type rather than as "4 × plan_purchased", because the point of
 * grouping is that four rows saying the same thing become one sentence a
 * person can read. The fallback keeps the count visible even for a type that
 * has no phrasing yet -- the rule is that nothing is dropped silently, and a
 * missing phrase must not become a missing row.
 */
const GROUPED: Record<string, (n: number) => string> = {
  message_received: (n) => `${n} new messages`,
  message_sent: (n) => `You sent ${n} messages`,
  demo_completed: (n) => `${n} demos were completed`,
  demo_requested: (n) => `You requested ${n} demos`,
  application_received: (n) => `${n} new applications`,
  application_submitted: (n) => `You applied for ${n} tuitions`,
  job_posted: (n) => `You posted ${n} tuitions`,
  payment_submitted: (n) => `You started ${n} payments`,
  plan_purchased: (n) => `Your plan changed ${n} times`,
  plan_granted: (n) => `Your plan changed ${n} times`,
  profile_viewed: (n) => `${n} profile views`,
  shortlist_added: (n) => `You shortlisted ${n} tutors`,
}

export function groupedLabel(type: string, count: number, sample: string): string {
  const phrase = GROUPED[type]
  if (phrase) return phrase(count)
  return `${sample} · ${count} times`
}
