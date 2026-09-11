// lib/pendingSignupCore.ts
//
// The pure decisions behind the "one SMS per number, nothing persisted until
// verified" signup (owner, 11 Sep 2026). No I/O and no imports, so proxy-free
// unit tests can pin the rules the money hinges on — the server modules
// (lib/pendingSignup.ts, lib/otp.ts) do the database work and call these.

/** Max wrong-code guesses on one pending row before it is burned. */
export const PENDING_MAX_ATTEMPTS = 5

/**
 * Is a code with this expiry still live at `nowMs`?
 *
 * The single rule the whole design turns on: a live code for a number means one
 * is already outstanding, so a second send is suppressed and the member is told
 * to use the one they have; a dead one frees the number and the next attempt
 * sends exactly one new SMS. Used for both the pending-signup row and the
 * signed-in phone_otps row.
 */
export function codeStillLive(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs > nowMs
}

export type PendingSendDecision =
  | { action: 'reuse' } // a live row exists — send nothing, say "already sent"
  | { action: 'send' } //  no live row — create one and send a single SMS

/**
 * Given the newest existing pending row for a number (or null), decide whether
 * to send a fresh code or reuse the outstanding one. `reuse` is the "we already
 * sent a code to this number, please use it" path — no second message.
 */
export function pendingSendDecision(
  existing: { expiresAtMs: number } | null,
  nowMs: number,
): PendingSendDecision {
  if (existing && codeStillLive(existing.expiresAtMs, nowMs)) return { action: 'reuse' }
  return { action: 'send' }
}

export type PendingVerifyState =
  | { state: 'ok' }
  | { state: 'expired' } //  the row is gone / past its expiry — start over
  | { state: 'locked' } //   too many wrong guesses — burned, start over
  | { state: 'wrong'; attemptsLeft: number }

/**
 * Classify a code submission against a pending row's stored state. PURE — the
 * caller supplies whether the submitted code matched (the stored code, or the
 * dev/bridge bypass) and the row's current attempt count and expiry.
 */
export function classifyPendingVerify(opts: {
  matched: boolean
  expiresAtMs: number
  attempts: number
  nowMs: number
}): PendingVerifyState {
  if (!codeStillLive(opts.expiresAtMs, opts.nowMs)) return { state: 'expired' }
  if (opts.attempts >= PENDING_MAX_ATTEMPTS) return { state: 'locked' }
  if (opts.matched) return { state: 'ok' }
  const attemptsLeft = Math.max(0, PENDING_MAX_ATTEMPTS - (opts.attempts + 1))
  return { state: 'wrong', attemptsLeft }
}
