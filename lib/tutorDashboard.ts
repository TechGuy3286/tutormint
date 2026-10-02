// Pure helpers for the tutor dashboard's verification-fee card and quota
// counter (PR106-B §2–§3), so the copy/state logic is unit-tested without the
// DB or the browser. Client-safe — no imports that reach the server.

export type FeeBenefitKey = 'badge' | 'google' | 'basic'

export type FeeCardState = {
  /** Has the one-time verification fee been paid? Drives the "Pay verification
   *  fee" button (never an amount — the amount lives only on the payment page). */
  paid: boolean
  lines: { key: FeeBenefitKey; done: boolean }[]
}

/**
 * The three verification-fee benefit lines and whether each is active yet.
 *   badge  → the green Verified badge: done once staff approve CNIC + photo +
 *            selfie (verifiedOk).
 *   google → the public page is findable on Google: done once the profile is
 *            100% complete AND approved (findable).
 *   basic  → apply to tuitions / view parent numbers on Basic: done once the fee
 *            is paid (the tutor is then on Basic).
 */
export function verificationFeeCardState(input: {
  feePaid: boolean
  verifiedOk: boolean
  findable: boolean
}): FeeCardState {
  return {
    paid: input.feePaid,
    lines: [
      { key: 'badge', done: input.verifiedOk },
      { key: 'google', done: input.findable },
      { key: 'basic', done: input.feePaid },
    ],
  }
}

export type QuotaCounter = {
  /** The line to show: "7 of 10 used this month" or "Unlimited". */
  text: string
  /** Featured hides the real number; Basic/Premium show it. */
  unlimited: boolean
  /** Show the small "Get more applications" link (Basic/Premium, at ~80%+). */
  showGetMore: boolean
}

/**
 * The dashboard quota counter for the shared monthly applications pool
 * (PR106-B §4–§5):
 *   - Featured  → "Unlimited" ONLY, never the real number, never a Get-more link.
 *   - Basic     → "{used} of {quota} used this month" (quota = 10).
 *   - Premium   → "{used} of {quota} used this month" (quota = 100) — the real
 *                 number IS shown here, deliberately (owner, this PR).
 *   - At ~80% used (Basic/Premium only), a "Get more applications" link appears.
 */
export function quotaCounter(input: {
  plan: string | null
  used: number
  quota: number
}): QuotaCounter {
  if (input.plan === 'featured') {
    return { text: 'Unlimited', unlimited: true, showGetMore: false }
  }
  const used = Math.max(0, input.used)
  const quota = Math.max(0, input.quota)
  const text = `${used} of ${quota} used this month`
  const showGetMore = quota > 0 && used / quota >= 0.8
  return { text, unlimited: false, showGetMore }
}
