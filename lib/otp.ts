// lib/otp.ts
//
// The phone-OTP rules, in one place.
//
// Three flows now need them, and they must not drift apart:
//
//   * /api/auth/otp        — prove a number belongs to the signed-in account
//                            (profile completion, and the signup gate)
//   * /api/auth/register   — send the first code the moment an account exists
//   * /api/auth/reset/*    — password reset for somebody who is signed OUT
//
// The rules themselves are unchanged from T3: 10-minute expiry, single use,
// five attempts then the code is burned, 60-second resend cooldown, five sends
// per number per hour.
//
// PURPOSE. A code carries the flow that issued it and is only ever accepted by
// that same flow. Without it, "the newest unconsumed code for this phone" is
// ambiguous the moment two flows are live: a password reset would consume a
// pending verification code, and a code minted for one purpose would be
// spendable in the other.
//
// EVERY read and write here goes through the service-role client. phone_otps
// has RLS on with no policies, so it is unreachable with the anon key — which
// is what stops the SMS step being skipped by simply reading the code back.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSmsProvider, devOtpCode } from '@/lib/sms'

export type OtpPurpose = 'verify' | 'reset'

export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_SENDS_PER_HOUR = 5

export type SendResult =
  | { ok: true; devBypassActive: boolean }
  | { ok: false; status: number; error: string; detail?: string; retryAfterSeconds?: number }

export type VerifyResult =
  | { ok: true; userId: string | null; devBypass: boolean }
  | { ok: false; status: number; error: string; attemptsLeft?: number; locked?: boolean }

const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  error: 'Verification is temporarily unavailable.',
  detail: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
}

/**
 * Issue a code and send it.
 *
 * `userId` may be null for a reset requested by somebody signed out, though
 * the reset route resolves it from the number first so the row is attributable.
 */
export async function sendOtp(opts: {
  phone: string
  purpose: OtpPurpose
  userId?: string | null
}): Promise<SendResult> {
  const admin = createAdminClient()
  if (!admin) return UNAVAILABLE

  const now = Date.now()

  // Per-number budget. The route also rate-limits per IP: one stops a single
  // number being spammed, the other stops a script walking a list of numbers,
  // and only the second costs real money a message at a time.
  const { data: recent } = await admin
    .from('phone_otps')
    .select('created_at')
    .eq('phone', opts.phone)
    .eq('purpose', opts.purpose)
    .gte('created_at', new Date(now - 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })

  if (recent && recent.length >= MAX_SENDS_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: 'Too many codes requested for this number. Try again in an hour.',
    }
  }

  if (recent && recent.length > 0) {
    const since = now - new Date(recent[0].created_at).getTime()
    if (since < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - since) / 1000)
      return {
        ok: false,
        status: 429,
        error: `Please wait ${wait}s before requesting another code.`,
        retryAfterSeconds: wait,
      }
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))

  const { error: insertError } = await admin.from('phone_otps').insert({
    phone: opts.phone,
    code,
    purpose: opts.purpose,
    user_id: opts.userId ?? null,
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
  })

  if (insertError) {
    return { ok: false, status: 500, error: insertError.message }
  }

  // With the dev bypass active there is nothing to deliver: the bypass code
  // verifies regardless, so no SMS is attempted and no bill is run up.
  if (devOtpCode()) return { ok: true, devBypassActive: true }

  const provider = getSmsProvider()
  const sent = await provider.send(
    opts.phone,
    `Your TutorMint verification code is ${code}. It expires in 10 minutes.`,
  )

  if (!sent.ok) {
    // Never claim success when nothing was sent.
    return {
      ok: false,
      status: 502,
      error: 'Could not send the verification code right now.',
      detail: sent.error,
    }
  }

  return { ok: true, devBypassActive: false }
}

/**
 * Check a submitted code.
 *
 * When `userId` is given the code must have been issued to that account, which
 * is what stops a signed-in member spending somebody else's code. The reset
 * flow leaves it out and takes the owner of the code from the row.
 */
export async function verifyOtp(opts: {
  phone: string
  code: string
  purpose: OtpPurpose
  userId?: string | null
}): Promise<VerifyResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: UNAVAILABLE.error }

  const submitted = opts.code.trim()
  if (!submitted) return { ok: false, status: 400, error: 'Enter the verification code.' }

  let query = admin
    .from('phone_otps')
    .select('id, code, expires_at, consumed_at, attempts, user_id')
    .eq('phone', opts.phone)
    .eq('purpose', opts.purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (opts.userId) query = query.eq('user_id', opts.userId)

  const { data: otp } = await query.maybeSingle()

  // The dev bypass still requires that a code was actually REQUESTED for this
  // number and purpose. The T3 route accepted it with nothing on file, which
  // was harmless when the only flow needed a session already; for a signed-out
  // password reset it would mean anyone could reset any account on a preview
  // deployment without touching the phone at all.
  const bypass = devOtpCode()
  if (bypass && submitted === bypass) {
    if (!otp) {
      return { ok: false, status: 400, error: 'No active code for this number. Request a new one.' }
    }
    await admin
      .from('phone_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
    return { ok: true, userId: otp.user_id ?? opts.userId ?? null, devBypass: true }
  }

  if (!otp) {
    return { ok: false, status: 400, error: 'No active code for this number. Request a new one.' }
  }

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    // Burn it, so an expired code cannot be retried.
    await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
    return { ok: false, status: 400, error: 'That code has expired. Request a new one.' }
  }

  if ((otp.attempts ?? 0) >= MAX_ATTEMPTS) {
    await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
    return {
      ok: false,
      status: 429,
      error: 'Too many incorrect attempts. Request a new code.',
      locked: true,
      attemptsLeft: 0,
    }
  }

  if (otp.code !== submitted) {
    const attempts = (otp.attempts ?? 0) + 1
    const locked = attempts >= MAX_ATTEMPTS
    await admin
      .from('phone_otps')
      .update({ attempts, consumed_at: locked ? new Date().toISOString() : null })
      .eq('id', otp.id)

    return {
      ok: false,
      status: locked ? 429 : 400,
      error: locked
        ? 'Too many incorrect attempts. Request a new code.'
        : `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
      locked,
    }
  }

  await admin
    .from('phone_otps')
    .update({ consumed_at: new Date().toISOString(), attempts: (otp.attempts ?? 0) + 1 })
    .eq('id', otp.id)

  return { ok: true, userId: otp.user_id ?? opts.userId ?? null, devBypass: false }
}
