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
import { getSmsProvider, devOtpCode, bridgeOtpCode } from '@/lib/sms'

export type OtpPurpose = 'verify' | 'reset'

export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5
// Five minutes (owner, Sunday 6 Sep): Resend sits behind a visible countdown
// and auto-reactivates. The 10-minute code TTL outlives one cooldown, so a
// member always has a live code while they wait to resend.
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000
export const MAX_SENDS_PER_HOUR = 5
// Per-number DAILY cap (Part 7 stage 2). Every send costs Re 1 from a prepaid
// balance the provider gives no way to check, and delivery is undetectable — so
// an uncapped resend is someone else's bill and a silent outage when the credit
// runs dry. Set one ABOVE the hourly burst cap so both bind independently: the
// hourly cap (5) limits a burst within any hour, the daily cap (6) is the day's
// cost ceiling — Rs 6 per number per day, worst case. Six is generous for a real
// member (the 5-minute cooldown and 10-minute code TTL mean a genuine verify
// needs one or two, rarely more); it exists to stop deliberate resend-abuse and
// balance-drain. A member who somehow exhausts it is never stuck: the
// WhatsApp/email support fallback is ALWAYS visible on /verify-phone and the
// completion Mobile step, not hidden behind a failure the system cannot detect.
export const MAX_SENDS_PER_DAY = 6

export type SendCapVerdict =
  | { ok: true }
  | { ok: false; reason: 'day' | 'hour' | 'cooldown'; retryAfterSeconds?: number }

/**
 * Decide whether another code may be sent to a number, from the timestamps of
 * its recent sends. PURE (no I/O), so the caps are unit-testable with a fixed
 * `now`: sendOtp does the one query and hands the timestamps here.
 *
 * Order: the daily cost ceiling first, then the hourly burst guard, then the
 * short resend cooldown (the only one that carries a countdown, for the UI).
 */
export function sendCapDecision(
  priorSendsMs: number[],
  nowMs: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): SendCapVerdict {
  const dayCount = priorSendsMs.filter((t) => t > nowMs - 24 * 60 * 60 * 1000).length
  if (dayCount >= MAX_SENDS_PER_DAY) return { ok: false, reason: 'day' }

  const hourCount = priorSendsMs.filter((t) => t > nowMs - 60 * 60 * 1000).length
  if (hourCount >= MAX_SENDS_PER_HOUR) return { ok: false, reason: 'hour' }

  if (priorSendsMs.length > 0) {
    const wait = resendWaitSeconds(Math.max(...priorSendsMs), nowMs, cooldownMs)
    if (wait > 0) return { ok: false, reason: 'cooldown', retryAfterSeconds: wait }
  }
  return { ok: true }
}

// Which path actually handled a send, made EXPLICIT so a do-nothing send can
// never masquerade as a real one (owner). Before, the bridge branch returned a
// bare `{ ok: true }` identical to a provider send — that is how last night's
// signup produced a code row, no WhatsApp, and no error anywhere.
//   'provider'   — handed to the SMS provider (accepted ≠ delivered; fire-and-forget)
//   'bridge'     — BRIDGE_OTP active and no provider: NOTHING dispatched; the
//                  member uses the owner-distributed code
//   'dev-bypass' — DEV_DEFAULT_OTP (non-production): nothing dispatched
export type SmsSendChannel = 'provider' | 'bridge' | 'dev-bypass'

export type SendResult =
  | { ok: true; channel: SmsSendChannel; devBypassActive: boolean; provider?: string }
  // A failed send (provider rejected it) AND the "no provider and no bridge"
  // case both land here — the latter is the `unconfigured` provider returning
  // ok:false, distinguishable in the logs by provider=none.
  | { ok: false; status: number; error: string; detail?: string; retryAfterSeconds?: number }

export type VerifyResult =
  | { ok: true; userId: string | null; devBypass: boolean; bridged: boolean }
  | { ok: false; status: number; error: string; attemptsLeft?: number; locked?: boolean }

/**
 * Seconds a member must still wait before Resend re-enables — 0 when the
 * cooldown has passed. Pure, so the 5-minute countdown is unit-testable with a
 * fixed `now`: the resend button and this share one number.
 */
export function resendWaitSeconds(
  lastSentAtMs: number,
  nowMs: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  const since = nowMs - lastSentAtMs
  if (since >= cooldownMs) return 0
  return Math.ceil((cooldownMs - since) / 1000)
}

/**
 * Which special code, if any, a submitted OTP is: the dev bypass, the
 * production bridge, or neither. The bypass wins a tie so a bridge value never
 * masquerades as one; `bridged` downstream is true only for the bridge, which
 * is what lets the verify route tag phone_verified_via='bridge'. Pure.
 */
export function otpMatch(
  submitted: string,
  bypass: string | null,
  bridge: string | null,
): 'bypass' | 'bridge' | 'none' {
  const s = submitted.trim()
  if (bypass && s === bypass) return 'bypass'
  if (bridge && s === bridge) return 'bridge'
  return 'none'
}

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

  // Per-number budget: a daily cost ceiling, an hourly burst guard, and the
  // 5-minute resend cooldown — all decided by sendCapDecision from one 24h read.
  // The route also rate-limits per IP: the per-number caps stop a single number
  // being spammed (and cap what one number can cost), the per-IP cap stops a
  // script walking a LIST of numbers, and only the second is a different money
  // threat. Every send here is a real Re 1 with no delivery receipt.
  const { data: recent } = await admin
    .from('phone_otps')
    .select('created_at')
    .eq('phone', opts.phone)
    .eq('purpose', opts.purpose)
    .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())

  const verdict = sendCapDecision(
    (recent ?? []).map((r) => new Date(r.created_at as string).getTime()),
    now,
  )
  if (!verdict.ok) {
    const error =
      verdict.reason === 'day'
        ? 'You have requested the most codes we allow for this number today. Try again tomorrow, or message support to verify your number.'
        : verdict.reason === 'hour'
          ? 'Too many codes requested for this number. Try again in an hour.'
          : `Please wait ${verdict.retryAfterSeconds}s before requesting another code.`
    return { ok: false, status: 429, error, retryAfterSeconds: verdict.retryAfterSeconds }
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
  if (devOtpCode()) {
    reportSend({ purpose: opts.purpose, phone: opts.phone, channel: 'dev-bypass', ok: true })
    return { ok: true, channel: 'dev-bypass', devBypassActive: true }
  }

  const provider = getSmsProvider()

  // The bridge is live only WHILE there is no real provider (it exists to fill
  // exactly that gap). So when a bridge code is set and no provider is
  // configured, there is nothing to send — the member enters the bridge code
  // the owner gave them. If a real provider IS configured, fall through and
  // send the real SMS; the bridge code still verifies as a backstop.
  //
  // This is the do-nothing path the owner flagged: it returns ok:true but marks
  // channel:'bridge' (never a bare success) AND logs that no message went out,
  // so a bridge-active-no-provider deployment is VISIBLE in the runtime logs
  // rather than looking identical to a delivered code.
  if (bridgeOtpCode() && !provider.isConfigured()) {
    reportSend({ purpose: opts.purpose, phone: opts.phone, channel: 'bridge', ok: true })
    return { ok: true, channel: 'bridge', devBypassActive: false }
  }

  const sent = await provider.send(
    opts.phone,
    `Your TutorMint verification code is ${code}. It expires in 10 minutes.`,
  )

  // Log every provider outcome — success (accepted, NOT confirmed delivered) and
  // failure alike. provider=none is the "no provider and no bridge" case (the
  // unconfigured provider returning ok:false); provider=smspoint ok=false is a
  // real rejection. Either way it is now a line in the log, where before there
  // was silence. The error text is the provider's own (carries no number/code).
  reportSend({
    purpose: opts.purpose,
    phone: opts.phone,
    channel: 'provider',
    provider: provider.name,
    ok: sent.ok,
    error: sent.ok ? undefined : sent.error,
  })

  if (!sent.ok) {
    // Never claim success when nothing was sent.
    return {
      ok: false,
      status: 502,
      error: 'Could not send the verification code right now.',
      detail: sent.error,
    }
  }

  return { ok: true, channel: 'provider', devBypassActive: false, provider: provider.name }
}

/**
 * Mask a mobile number for a log line: country code + last 3 digits, the middle
 * starred. Never the full number. A code is never passed to a logger at all.
 */
export function maskMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 5) return '***'
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 5)}${digits.slice(-3)}`
}

/**
 * One structured, greppable line per send outcome — the logging the diagnosis
 * found entirely absent from this path. success → info, failure → warn.
 * NEVER a full number (masked) or the code (never passed here); the only free
 * text is the provider's own error string, which by contract echoes neither.
 */
function reportSend(o: {
  purpose: OtpPurpose
  phone: string
  channel: SmsSendChannel
  provider?: string
  ok: boolean
  error?: string
}): void {
  const line = [
    '[otp] send',
    `purpose=${o.purpose}`,
    `to=${maskMsisdn(o.phone)}`,
    `channel=${o.channel}`,
    o.provider ? `provider=${o.provider}` : '',
    `ok=${o.ok}`,
    !o.ok && o.error ? `error=${JSON.stringify(o.error)}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  if (o.ok) console.info(line)
  else console.warn(line)
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

  // The dev bypass AND the production bridge both still require that a code was
  // actually REQUESTED for this number and purpose. The T3 route accepted it
  // with nothing on file, which was harmless when the only flow needed a
  // session already; for a signed-out password reset it would mean anyone could
  // reset any account on a preview deployment without touching the phone at all.
  //
  // dev bypass (DEV_DEFAULT_OTP, non-production only) and bridge (BRIDGE_OTP,
  // production-allowed) are checked together; `bridged` is true only for the
  // bridge, so the verify route can tag phone_verified_via='bridge'.
  const match = otpMatch(submitted, devOtpCode(), bridgeOtpCode())
  const isBypass = match === 'bypass'
  const isBridge = match === 'bridge'
  if (isBypass || isBridge) {
    if (!otp) {
      return { ok: false, status: 400, error: 'No active code for this number. Request a new one.' }
    }
    await admin
      .from('phone_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
    return { ok: true, userId: otp.user_id ?? opts.userId ?? null, devBypass: isBypass, bridged: isBridge }
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

  return { ok: true, userId: otp.user_id ?? opts.userId ?? null, devBypass: false, bridged: false }
}
