// lib/switchedTutorEmailCore.ts
//
// The ONE-TIME email to the email-only tutors who were switched on 13 Oct 2026
// (scripts/dataop-open-email-tutors.ts): they can now sign in, and nobody told
// them. Pure rules — no database — tested in scripts/test-switched-email.ts.
//
// SENT ONCE. The send is recorded in one_off_emails (unique per member and
// key, migration 170) BEFORE the email leaves, so a second run can never send
// again. Skipped: anyone who has since verified a mobile, is paused or banned,
// or is a test or staff account.
//
// This is the single exception to "an address waiting for its confirmation
// link receives only the confirmation email" (lib/emailConfirmCore
// mayEmailAddress): the owner asked for this one email by name.

/** The one_off_emails key. One email per member under this key, ever. */
export const SWITCHED_EMAIL_KEY = 'switched_tutor_signin_2026_10_13'

/** The template id (lib/notify/templates). */
export const SWITCHED_EMAIL_TEMPLATE = 'switched_tutor_signin'

export const SWITCHED_EMAIL_SUBJECT = 'You can now sign in to TutorMint'

export type SwitchedTutorFacts = {
  /** Was this account one of those switched on 13 Oct 2026? */
  switched: boolean
  role: string | null
  /** A staff role, if any. */
  adminRole: string | null
  email: string | null
  mobileVerified: boolean
  suspended: boolean
  banned: boolean
  selfPaused: boolean
  isSeed: boolean
  isTestName: boolean
  hiddenFromPublic: boolean
  alreadySent: boolean
}

export type SkipReason = 'not_switched' | 'already_sent' | 'mobile_verified' | 'paused' | 'test_or_staff' | 'no_email'

/** Why this tutor is NOT emailed, or null when they are. */
export function switchedEmailSkip(f: SwitchedTutorFacts): SkipReason | null {
  if (!f.switched) return 'not_switched'
  if (f.alreadySent) return 'already_sent'
  if (f.role !== 'tutor' || f.adminRole || f.isSeed || f.isTestName || f.hiddenFromPublic) return 'test_or_staff'
  if (f.suspended || f.banned || f.selfPaused) return 'paused'
  if (f.mobileVerified) return 'mobile_verified'
  const e = (f.email ?? '').trim().toLowerCase()
  if (!e || !e.includes('@') || e.endsWith('@users.tutormint.org')) return 'no_email'
  return null
}

export type SwitchedPlan = { send: string[]; skipped: Record<SkipReason, number> }

/** Who is sent the email and who is skipped (counts only — no addresses). */
export function planSwitchedEmails(rows: (SwitchedTutorFacts & { id: string })[]): SwitchedPlan {
  const skipped: Record<SkipReason, number> = { not_switched: 0, already_sent: 0, mobile_verified: 0, paused: 0, test_or_staff: 0, no_email: 0 }
  const send: string[] = []
  for (const r of rows) {
    const why = switchedEmailSkip(r)
    if (why) skipped[why] += 1
    else send.push(r.id)
  }
  return { send, skipped }
}
