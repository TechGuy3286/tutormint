// The PURE half of the under-review logic — no 'server-only', so it runs in the
// test runner (scripts/test-auth-trust.ts). lib/underReview.ts re-exports it and
// adds the service-role reads/writes.

/**
 * The auto-trigger (owner, Sunday 6 Sep): a reported target flips to under
 * review on ONE report from a verified member, or TWO from anyone. Both the job
 * and the profile branch decide with this, so the threshold cannot drift.
 */
export function crossesReviewThreshold(input: {
  hasVerifiedReporter: boolean
  openReportCount: number
}): boolean {
  return input.hasVerifiedReporter || input.openReportCount >= 2
}
