// lib/submitGuard.ts
//
// One send per tap (owner, 31 Oct 2026). Every button that makes Supabase Auth
// or TutorMint send an email (sign-up, password reset, resend confirmation,
// add an email) refuses a second press while the first is still going, and a
// "resend" refuses another press for a minute after a send. Pure, so the
// screens and scripts/test-email-change.ts read the same rule.

export const RESEND_COOLDOWN_MS = 60_000

/** May this resend button send now? */
export function resendAllowed(input: { busy: boolean; lastSentAt: number | null; now: number; cooldownMs?: number }): boolean {
  if (input.busy) return false
  if (input.lastSentAt == null) return true
  return input.now - input.lastSentAt >= (input.cooldownMs ?? RESEND_COOLDOWN_MS)
}

/**
 * Wrap a submit handler so a second call while the first is running does
 * nothing. The flag lives in a ref-like box, so a double click in the same
 * frame (before any "busy" state renders) is still caught.
 */
export function onceAtATime<A extends unknown[]>(box: { current: boolean }, fn: (...a: A) => Promise<void>): (...a: A) => Promise<void> {
  return async (...a: A) => {
    if (box.current) return
    box.current = true
    try {
      await fn(...a)
    } finally {
      box.current = false
    }
  }
}
