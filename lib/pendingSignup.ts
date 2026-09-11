import 'server-only'

import { randomBytes } from 'node:crypto'
import { hash as bcryptHash } from 'bcryptjs'

import { createAdminClient } from '@/lib/supabase/admin'
import { CODE_TTL_MS, deliverCode, type DeliverResult } from '@/lib/otp'
import { otpMatch } from '@/lib/otp'
import { devOtpCode, bridgeOtpCode } from '@/lib/sms'
import { syntheticEmail } from '@/lib/phone'
import { checkBlocklist } from '@/lib/blocklist'
import { ensureProfile } from '@/lib/ensureProfile'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import {
  pendingSendDecision,
  classifyPendingVerify,
  codeStillLive,
} from '@/lib/pendingSignupCore'

// Nothing is persisted for an UNVERIFIED mobile signup (owner, 11 Sep 2026).
//
// A mobile signup creates NO auth user and NO profiles row until the code
// verifies. The draft (name, role, bcrypt-hashed password, mobile) lives in a
// short-lived `pending_signups` row (migration 75) keyed by a token in an
// httpOnly cookie, and the account is created ONLY when verifyPendingSignup
// succeeds. Until then the number is free and re-registering is allowed.
//
// The password is stored as a BCRYPT HASH, never plaintext: the account is
// created with GoTrue's admin `password_hash` (which accepts bcrypt), and the
// session is minted with a magic-link token (in the route), so the plaintext is
// never needed after this row is written and never touches the database.
//
// ONE SMS PER NUMBER PER ATTEMPT — a live row means a code is outstanding, so a
// second attempt reuses it and sends nothing. The per-IP cap on the route stops
// a script walking many numbers.

/** The httpOnly cookie carrying the pending row's token. */
export const PENDING_COOKIE = 'tm_pending_signup'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type StartResult =
  | { ok: true; alreadySent: true; token: string }
  | { ok: true; alreadySent: false; token: string; devBypassActive: boolean }
  | { ok: false; status: number; error: string; detail?: string }

/**
 * Begin a mobile signup: reuse a live code if one is outstanding for the
 * number, otherwise store the draft and send exactly one SMS. Blocklist and
 * duplicate-real-account checks happen in the route BEFORE this (the duplicate
 * check reads real profiles, never this table).
 */
export async function startPendingSignup(opts: {
  role: 'tutor' | 'parent'
  fullName: string
  mobile: string
  password: string
  utm?: Record<string, unknown>
}): Promise<StartResult> {
  const admin = createAdminClient()
  if (!admin) {
    return {
      ok: false,
      status: 503,
      error: 'Sign-up is temporarily unavailable.',
      detail: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
    }
  }

  const now = Date.now()

  // A live pending row for this number means a code is still outstanding: reuse
  // it, send nothing, and hand back its token so the caller can re-point the
  // cookie at it (works across devices — verifying still needs the code).
  const { data: existing } = await admin
    .from('pending_signups')
    .select('token, expires_at')
    .eq('mobile', opts.mobile)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const decision = pendingSendDecision(
    existing ? { expiresAtMs: new Date(existing.expires_at as string).getTime() } : null,
    now,
  )
  if (decision.action === 'reuse' && existing) {
    return { ok: true, alreadySent: true, token: existing.token as string }
  }

  const token = randomBytes(32).toString('base64url')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const passwordHash = await bcryptHash(opts.password, 10)

  const { error: insertError } = await admin.from('pending_signups').insert({
    token,
    role: opts.role,
    full_name: opts.fullName,
    mobile: opts.mobile,
    password_hash: passwordHash,
    code,
    utm: opts.utm ?? null,
    attempts: 0,
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
  })
  if (insertError) {
    return { ok: false, status: 500, error: 'Could not start sign-up. Please try again.', detail: insertError.message }
  }

  const delivered: DeliverResult = await deliverCode(opts.mobile, code, 'verify')
  if (!delivered.ok) {
    // A pending row for a code that never went out would block the number for
    // ten minutes with nothing delivered. Remove it so the member can retry.
    await admin.from('pending_signups').delete().eq('token', token)
    return { ok: false, status: delivered.status, error: delivered.error, detail: delivered.detail }
  }

  return { ok: true, alreadySent: false, token, devBypassActive: delivered.devBypassActive }
}

/**
 * The number a live pending row is for, or null. Used by /verify-phone to render
 * the pre-auth code entry without a session. A dead/absent row returns null (and
 * the caller clears the cookie).
 */
export async function readPendingMobile(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('pending_signups')
    .select('mobile, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!data) return null
  if (!codeStillLive(new Date(data.expires_at as string).getTime(), Date.now())) return null
  return data.mobile as string
}

export type VerifyPendingResult =
  | { ok: true; userId: string; role: 'tutor' | 'parent'; email: string; bridged: boolean }
  | { ok: false; status: number; error: string; reason: 'expired' | 'locked' | 'wrong' | 'blocked' | 'exists' | 'server'; attemptsLeft?: number }

/**
 * Verify a pending code and, on success, CREATE THE ACCOUNT — this is the step
 * that persists anything. The session is minted by the route afterwards.
 */
export async function verifyPendingSignup(opts: {
  token: string
  code: string
  utm?: Record<string, unknown>
}): Promise<VerifyPendingResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, status: 503, error: 'Verification is temporarily unavailable.', reason: 'server' }
  }

  const { data: row } = await admin
    .from('pending_signups')
    .select('token, role, full_name, mobile, password_hash, code, utm, attempts, expires_at')
    .eq('token', opts.token)
    .maybeSingle()

  const EXPIRED = {
    ok: false as const,
    status: 400,
    error: 'That code has expired. Start over to get a new one.',
    reason: 'expired' as const,
  }
  if (!row) return EXPIRED

  const submitted = opts.code.trim()
  const special = otpMatch(submitted, devOtpCode(), bridgeOtpCode())
  const matched = submitted === (row.code as string) || special !== 'none'
  const bridged = special === 'bridge'

  const verdict = classifyPendingVerify({
    matched,
    expiresAtMs: new Date(row.expires_at as string).getTime(),
    attempts: (row.attempts as number) ?? 0,
    nowMs: Date.now(),
  })

  if (verdict.state === 'expired') {
    await admin.from('pending_signups').delete().eq('token', opts.token)
    return EXPIRED
  }
  if (verdict.state === 'locked') {
    await admin.from('pending_signups').delete().eq('token', opts.token)
    return {
      ok: false,
      status: 429,
      error: 'Too many incorrect codes. Start over to get a new one.',
      reason: 'locked',
    }
  }
  if (verdict.state === 'wrong') {
    await admin
      .from('pending_signups')
      .update({ attempts: ((row.attempts as number) ?? 0) + 1 })
      .eq('token', opts.token)
    return {
      ok: false,
      status: 400,
      error: `Incorrect code. ${verdict.attemptsLeft} attempt(s) left.`,
      reason: 'wrong',
      attemptsLeft: verdict.attemptsLeft,
    }
  }

  // ---- verified: create the account (the only place anything is persisted) ----
  const mobile = row.mobile as string
  const role = row.role as 'tutor' | 'parent'
  const fullName = row.full_name as string
  const email = syntheticEmail(mobile)

  // Re-check the two conditions that could have changed during the window.
  const blocked = await checkBlocklist({ mobile })
  if (blocked?.mobile) {
    await admin.from('pending_signups').delete().eq('token', opts.token)
    return {
      ok: false,
      status: 403,
      error: 'We could not create an account with these details. If you think this is a mistake, please contact support.',
      reason: 'blocked',
    }
  }

  const dup = await realAccountForMobile(admin, mobile, email)
  if (dup) {
    await admin.from('pending_signups').delete().eq('token', opts.token)
    return {
      ok: false,
      status: 409,
      error: 'An account already uses that mobile number. Try signing in instead.',
      reason: 'exists',
    }
  }

  // password_hash (bcrypt) — the plaintext never reached the server after
  // /register. email_confirm: true because a synthetic address accepts no mail
  // and the mobile is what was verified.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password_hash: row.password_hash as string,
    email_confirm: true,
    user_metadata: { role, full_name: fullName },
  })
  if (createError || !created?.user) {
    return {
      ok: false,
      status: 400,
      error: createError?.message ?? 'Could not create the account.',
      reason: 'server',
    }
  }
  const userId = created.user.id

  const utm = (row.utm as Record<string, unknown> | null) ?? opts.utm
  const made = await ensureProfile(admin, {
    userId,
    role,
    fullName,
    email,
    phoneNumber: mobile,
    utm: utm ?? undefined,
  })
  if (!made.ok) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, status: 500, error: 'Could not finish creating the account. Please try again.', reason: 'server' }
  }

  // The number is already proved — mark it verified now, so the account is
  // never held at the phone gate. 'bridge' when the shared code verified it, so
  // it can be made to re-verify when the real provider lands.
  await admin
    .from('profiles')
    .update({
      phone_verified_at: new Date().toISOString(),
      phone_verified: true,
      phone_verified_via: bridged ? 'bridge' : 'otp',
      phone_gate_required: false,
    })
    .eq('id', userId)

  // The draft is consumed — remove it (and any older rows for this number).
  await admin.from('pending_signups').delete().eq('mobile', mobile)

  await recomputeCompletion(userId)
  await logActivity({ userId, event: 'registered', meta: { via: 'mobile' } })
  await logActivity({ userId, event: 'otp_verified', targetType: 'profile', targetId: userId })

  return { ok: true, userId, role, email, bridged }
}

/** True when a REAL account already holds this number (never a pending row). */
async function realAccountForMobile(admin: Admin, mobile: string, email: string): Promise<boolean> {
  const national = `0${mobile.slice(2)}`
  const { data: byPhone } = await admin
    .from('profiles')
    .select('id')
    .or(`phone_number.eq.${mobile},phone_number.eq.${national},phone_number.eq.+${mobile}`)
    .limit(1)
    .maybeSingle()
  if (byPhone) return true
  const { data: byEmail } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()
  return !!byEmail
}

/**
 * Delete expired pending rows. Rows are dead the moment their expiry passes
 * (every read filters on it), so this is cleanup, not correctness — run on the
 * daily cron so stale drafts do not accumulate.
 */
export async function expirePendingSignups(): Promise<{ deleted: number }> {
  const admin = createAdminClient()
  if (!admin) return { deleted: 0 }
  const { data } = await admin
    .from('pending_signups')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('token')
  return { deleted: (data ?? []).length }
}
