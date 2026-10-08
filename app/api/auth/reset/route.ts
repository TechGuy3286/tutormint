import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp, verifyOtp, RESET_MESSAGES, type VerifyResult } from '@/lib/otp'
import { restoreSelfPauseOnSignIn } from '@/lib/selfPause'
import { homeForRole, type Role } from '@/lib/authRoutes'
import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'

// Password reset by SMS code, for somebody who is signed OUT (owner hotfix,
// 5 Oct 2026 — three screens).
//
//   POST { action: 'request', mobile }                    screen 1 → sends a code
//   POST { action: 'check',   mobile, code }              screen 2 → checks it
//   POST { action: 'confirm', mobile, code, password }    screen 3 → saves, signs in
//
// NOT AN ORACLE. 'request' answers identically whether or not the number has an
// account: a code is SENT only to a mobile that is VERIFIED on an account; for
// any other number lib/otp stores a decoy row and dispatches nothing, so screen
// 2 appears, every error (wrong / expired / too many / daily limit) reads the
// same, and no SMS ever goes to a stranger's handset.
//
// The reset code is a separate rule set from the one-time signup code
// (purpose='reset' in lib/otp): 10-minute expiry, 5 wrong tries lock it, 3 per
// mobile per day, a new code cancels the old one. Stored hashed. 'check' validates
// without consuming (the code stays good for screen 3 within its 10 minutes);
// 'confirm' consumes it, sets the password, signs out every other session on the
// account and mints a session for this browser.

const ResetBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), mobile: pkMobile }),
  z.object({ action: z.literal('check'), mobile: pkMobile, code: z.string().max(32) }),
  z.object({
    action: z.literal('confirm'),
    mobile: pkMobile,
    code: z.string().max(32),
    password: z.string().min(8, 'Use at least 8 characters.').max(200),
  }),
])

const SUPPORT_HREF = whatsappHref(
  SUPPORT_WHATSAPP_FALLBACK,
  'Assalam-o-Alaikum, I need help resetting my TutorMint password.',
)

/** The plain-English + Urdu answer for a failed code check. */
function codeFailure(result: Extract<VerifyResult, { ok: false }>) {
  const kind = result.expired ? 'expired' : result.locked ? 'locked' : 'wrong'
  const m = RESET_MESSAGES[kind]
  return NextResponse.json(
    { error: m.en, errorUr: m.ur, locked: !!result.locked, expired: !!result.expired, attemptsLeft: result.attemptsLeft },
    { status: result.status },
  )
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, ResetBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // A reset request costs an SMS; a check/confirm is a guess at a code. Separate
  // per-IP budgets, same reasoning as the OTP route.
  const bucket = body.action === 'request' ? 'otp_send' : 'otp_verify'
  const limit = await rateLimit(bucket, callerIp(request))
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, bucket === 'otp_send' ? 'requests' : 'attempts')
  }

  const msisdn = normalisePkMobile(body.mobile)
  const admin = createAdminClient()

  if (!admin) {
    return NextResponse.json({ error: 'Password reset is temporarily unavailable.' }, { status: 503 })
  }

  // ------------------------------------------------------------- request ---
  if (body.action === 'request') {
    if (msisdn) {
      const national = `0${msisdn.slice(2)}`
      // Only a VERIFIED mobile on an account gets a real code.
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
        .not('phone_verified_at', 'is', null)
        .limit(1)
        .maybeSingle()

      const result = profile
        ? await sendOtp({ phone: msisdn, purpose: 'reset', userId: profile.id as string })
        : await sendOtp({ phone: msisdn, purpose: 'reset', userId: null, silent: true })

      if (!result.ok && result.dailyLimit) {
        return NextResponse.json(
          { error: RESET_MESSAGES.dailyLimit.en, errorUr: RESET_MESSAGES.dailyLimit.ur, dailyLimit: true, supportHref: SUPPORT_HREF },
          { status: 429 },
        )
      }
      if (!result.ok) {
        return NextResponse.json({ error: 'Could not send a code right now. Please try again.' }, { status: 502 })
      }
    }
    // The same answer for a member and a stranger.
    return NextResponse.json({ success: true })
  }

  // A number that does not normalise has no code: it reads as expired, the same
  // as any other dead code.
  if (!msisdn) {
    return NextResponse.json({ error: RESET_MESSAGES.expired.en, errorUr: RESET_MESSAGES.expired.ur, expired: true }, { status: 400 })
  }

  // --------------------------------------------------------------- check ---
  if (body.action === 'check') {
    const result = await verifyOtp({ phone: msisdn, code: body.code, purpose: 'reset', commit: false })
    if (!result.ok) return codeFailure(result)
    // A decoy row (no account) can only ever read as a wrong code.
    if (!result.userId) {
      return NextResponse.json({ error: RESET_MESSAGES.wrong.en, errorUr: RESET_MESSAGES.wrong.ur }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  }

  // ------------------------------------------------------------- confirm ---
  const result = await verifyOtp({ phone: msisdn, code: body.code, purpose: 'reset' })
  if (!result.ok) return codeFailure(result)
  if (!result.userId) {
    return NextResponse.json({ error: RESET_MESSAGES.wrong.en, errorUr: RESET_MESSAGES.wrong.ur }, { status: 400 })
  }
  const userId = result.userId

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: body.password })
  if (updateError) {
    return NextResponse.json({ error: 'Could not save the new password. Please try again.' }, { status: 500 })
  }

  // A temporary password that has now been replaced is no longer temporary.
  await admin.from('profiles').update({ must_change_password: false }).eq('id', userId)

  // Sign out every other session on the account BEFORE minting this one.
  try {
    await admin.rpc('revoke_user_sessions', { uid: userId })
  } catch {
    /* best effort — the password itself has changed */
  }

  await logActivity({
    userId,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: userId,
    meta: { changed: 'password_reset_by_sms' },
  })

  // Sign the member in here: an admin magic-link token verified on the
  // cookie-backed client (the same mechanism the signup verify route uses), so
  // the new password is never round-tripped a second time.
  let signedIn = false
  const { data: userRow } = await admin.auth.admin.getUserById(userId)
  const email = userRow?.user?.email
  if (email) {
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = link?.properties?.hashed_token
    if (tokenHash) {
      const supabase = await createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
      if (!verifyError) signedIn = true
    }
  }
  // A self-paused member who resets their password and is signed in here is
  // back (owner, 8 Oct 2026) — never a staff-suspended or banned one.
  const restored = signedIn ? await restoreSelfPauseOnSignIn(userId) : false

  const { data: prof } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  const role = ((prof?.role as string | null) ?? null) as Role | null

  return NextResponse.json({
    success: true,
    signedIn,
    role,
    restored,
    next: signedIn ? (restored ? `${homeForRole(role)}?welcome=back` : homeForRole(role)) : '/login',
  })
}
