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
import { codeStillLive } from '@/lib/pendingSignupCore'

export type OtpPurpose = 'verify' | 'reset'

export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5

// ONE SMS PER NUMBER PER ATTEMPT (owner, 11 Sep 2026). At 4.80 PKR a message,
// resends are real money, so the per-number cooldown / hourly / daily caps are
// gone and replaced by a single rule: while a code is still LIVE for a number
// (unconsumed and unexpired), a second send is suppressed and the member is
// told to use the one they already have. The 10-minute code TTL IS the resend
// interval — when it lapses the number is free and one new SMS may go. The
// per-IP cap (otp_send / register buckets) still stops one actor burning the
// balance across many numbers; that lives in the routes, not here.

// Which path actually handled a send, made EXPLICIT so a do-nothing send can
// never masquerade as a real one (owner). Before, the bridge branch returned a
// bare `{ ok: true }` identical to a provider send — that is how a signup once
// produced a code row, no delivery, and no error anywhere.
//   'provider'   — handed to the SMS provider (accepted ≠ delivered; fire-and-forget)
//   'bridge'     — BRIDGE_OTP active and no provider: NOTHING dispatched; the
//                  member uses the owner-distributed code
//   'dev-bypass' — DEV_DEFAULT_OTP (non-production): nothing dispatched
//   'existing'   — a live code already exists: NOTHING dispatched, use that one
export type SmsSendChannel = 'provider' | 'bridge' | 'dev-bypass' | 'existing'

export type SendResult =
  // alreadySent:true means channel==='existing' — a live code was found and no
  // new message went out. Otherwise a fresh code was dispatched on `channel`.
  | { ok: true; channel: SmsSendChannel; devBypassActive: boolean; provider?: string; alreadySent: boolean }
  // A failed send (provider rejected it) AND the "no provider and no bridge"
  // case both land here — the latter is the `unconfigured` provider returning
  // ok:false, distinguishable in the logs by provider=none.
  | { ok: false; status: number; error: string; detail?: string }

export type VerifyResult =
  | { ok: true; userId: string | null; devBypass: boolean; bridged: boolean }
  | { ok: false; status: number; error: string; attemptsLeft?: number; locked?: boolean }

export type DeliverResult =
  | { ok: true; channel: 'provider' | 'bridge' | 'dev-bypass'; devBypassActive: boolean; provider?: string }
  | { ok: false; status: number; error: string; detail?: string }

/**
 * Dispatch a code to a number — the dev-bypass / bridge / provider decision in
 * ONE place, shared by sendOtp (signed-in verification, phone_otps) and
 * lib/pendingSignup.ts (pre-auth signup, pending_signups). The caller has
 * already persisted the code in its own store; this only sends it.
 *
 *   - dev bypass active  → send nothing (the bypass code verifies regardless)
 *   - bridge active AND no provider configured → send nothing (owner distributes
 *     the shared code); marked channel:'bridge', never a bare success
 *   - otherwise → hand it to the SMS provider (accepted ≠ delivered)
 */
export async function deliverCode(
  phone: string,
  code: string,
  purpose: OtpPurpose,
): Promise<DeliverResult> {
  // Dev bypass: nothing to deliver, and no bill run up.
  if (devOtpCode()) {
    reportSend({ purpose, phone, channel: 'dev-bypass', ok: true })
    return { ok: true, channel: 'dev-bypass', devBypassActive: true }
  }

  const provider = getSmsProvider()

  // Bridge is live only WHILE there is no real provider. Nothing is sent; the
  // member enters the owner-distributed bridge code.
  if (bridgeOtpCode() && !provider.isConfigured()) {
    reportSend({ purpose, phone, channel: 'bridge', ok: true })
    return { ok: true, channel: 'bridge', devBypassActive: false }
  }

  const sent = await provider.send(
    phone,
    `Your TutorMint verification code is ${code}. It expires in 10 minutes.`,
  )

  reportSend({
    purpose,
    phone,
    channel: 'provider',
    provider: provider.name,
    ok: sent.ok,
    id: sent.ok ? sent.id ?? undefined : undefined,
    error: sent.ok ? undefined : sent.error,
  })

  if (!sent.ok) {
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

  // ONE SMS PER NUMBER: is there already a LIVE code (unconsumed, unexpired) for
  // this number and purpose? If so, send nothing and tell the caller to use it.
  // This is the per-number money guard, replacing the old cooldown/hour/day
  // caps; the per-IP cap on the route stops a script walking a list of numbers.
  const { data: existing } = await admin
    .from('phone_otps')
    .select('expires_at')
    .eq('phone', opts.phone)
    .eq('purpose', opts.purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && codeStillLive(new Date(existing.expires_at as string).getTime(), now)) {
    reportSend({ purpose: opts.purpose, phone: opts.phone, channel: 'existing', ok: true })
    // devBypassActive still surfaced so a dev environment shows the test-code
    // hint even when a live code is being reused.
    return { ok: true, channel: 'existing', devBypassActive: !!devOtpCode(), alreadySent: true }
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

  const delivered = await deliverCode(opts.phone, code, opts.purpose)
  if (!delivered.ok) return delivered

  return {
    ok: true,
    channel: delivered.channel,
    devBypassActive: delivered.devBypassActive,
    provider: delivered.provider,
    alreadySent: false,
  }
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
  id?: string
  error?: string
}): void {
  const line = [
    '[otp] send',
    `purpose=${o.purpose}`,
    `to=${maskMsisdn(o.phone)}`,
    `channel=${o.channel}`,
    o.provider ? `provider=${o.provider}` : '',
    `ok=${o.ok}`,
    o.id ? `id=${o.id}` : '',
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
