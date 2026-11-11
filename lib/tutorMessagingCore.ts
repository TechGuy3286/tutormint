// lib/tutorMessagingCore.ts
//
// PURE rules for what a tutor may say to a parent (owner, 11 Nov 2026).
// Messaging parents needs the Verification Fee: an unpaid tutor cannot start
// a conversation, reply in one, apply with a note, or send a demo-decline
// reason — every server path refuses or replaces the text. Messaging the
// TutorMint Team (support) stays open to everyone. Flagged content (a banned
// word) is never delivered to a parent, whoever sends it.
//
// Unit-tested by scripts/test-staff-pause.ts.

/** What an unpaid tutor is shown, with the Verify button (the tutor_verify gate). */
export const GET_VERIFIED_TO_MESSAGE = 'Get verified to message parents.'

/** The neutral line a parent sees when a tutor's decline reason is not sent. */
export const DEMO_DECLINE_FIXED = "The tutor can't take this demo right now."

/** May this tutor's own words reach the parent? Only a verified (fee-paid)
 *  tutor's, and never words with a banned term. */
export function tutorTextToParent(p: { verified: boolean; abusive: boolean }): boolean {
  return p.verified && !p.abusive
}
