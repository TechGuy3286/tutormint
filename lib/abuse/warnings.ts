// lib/abuse/warnings.ts
//
// The plain-English words a member sees when their content is flagged (PR41 §3).
// PURE — no server-only, no I/O — so the server (sendMessage, the flagger) and
// the unit tests read the same copy, and the client can render the withheld
// bubble line without pulling anything server-side into the browser bundle.
//
// FLAG NUMBER → what the member is told:
//   1  first warning  — not sent; this language is not allowed; it can lead to suspension
//   2  second warning — names the count, and the consequence: one more suspends the account
//   3+ suspension     — the account is suspended, with the appeal route
//
// Warnings appear IN THE APP, in the conversation — never by email.

import { SUPPORT_WHATSAPP_DISPLAY, SUPPORT_EMAIL_FALLBACK } from '@/lib/supportContacts'

/** The auto-suspend threshold — the third open flag. Shared with lib/abuse/flag. */
export const AUTO_SUSPEND_AT = 3

/** The line on the sender's own withheld message bubble. Never shows the matched
 *  word back to them. */
export const WITHHELD_MESSAGE_LINE = 'Not sent — this message breaks our rules.'

/** The one-line reason a withheld profile field / display name / tuition shows.
 *  A short, plain notice; no matched word, no threat. */
export const WITHHELD_CONTENT_LINE =
  "This wasn't saved because the wording isn't allowed on TutorMint. Please change it and try again."

/** The one-line reason a withheld (not-posted) tuition shows. */
export const WITHHELD_TUITION_LINE =
  "This tuition wasn't posted because the wording isn't allowed on TutorMint. Please change it and try again."

export type AbuseWarning = {
  /** The flag number this was for the member. */
  level: number
  /** True once this flag is the suspension (the third). */
  suspended: boolean
  /** The plain line shown to the sender, in the conversation. */
  text: string
}

/**
 * The escalating warning for a flagged MESSAGE, by flag number.
 *
 * `level` is the member's open-flag count after this flag. 1 and 2 are warnings;
 * 3 and above are the suspension (the account is already suspended by the time
 * this is shown). The copy is deliberately calm and specific — "not sent", the
 * rule, the consequence — because a threatening wall of text is what a
 * not-highly-literate member reads as noise.
 */
export function abuseWarning(level: number, suspended: boolean): AbuseWarning {
  if (suspended || level >= AUTO_SUSPEND_AT) {
    return {
      level,
      suspended: true,
      text: `This message was not sent. Your account has been suspended for repeated messages that break our rules. To appeal, message support on WhatsApp ${SUPPORT_WHATSAPP_DISPLAY} or email ${SUPPORT_EMAIL_FALLBACK}.`,
    }
  }
  if (level >= 2) {
    return {
      level,
      suspended: false,
      text: 'This message was not sent. This is the second time. This kind of language is not allowed on TutorMint — one more and your account will be suspended.',
    }
  }
  return {
    level,
    suspended: false,
    text: 'This message was not sent. This kind of language is not allowed on TutorMint. If it happens again, your account can be suspended.',
  }
}

/** How /admin/flags and the member page label a flag's stage. */
export function flagStageLabel(warningLevel: number | null): string {
  if (warningLevel == null) return 'Flag'
  if (warningLevel >= AUTO_SUSPEND_AT) return 'Suspension'
  return `Warning ${warningLevel}`
}
