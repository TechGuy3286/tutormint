import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp, verifyOtp } from '@/lib/otp'

// Password reset by mobile number, for somebody who is signed OUT.
//
//   POST { action: 'request', mobile }
//   POST { action: 'confirm', mobile, code, password }
//
// This exists because an account registered with a mobile and no email has no
// inbox to send a reset link to. The email path still exists on
// /forgot-password for members who gave an address; this is the other half.
//
// NOT AN ORACLE. 'request' returns exactly the same response whether or not
// that number has an account — otherwise it would answer "is 0300 1234567
// registered on TutorMint?" for anyone who asked, one number at a time, which
// is the leak /api/auth/login goes to some trouble to avoid.
//
// 'confirm' leaks nothing either, because "no account for this number" and "no
// pending code for this number" produce the identical message from lib/otp.
//
// The code carries purpose='reset' and is only accepted here. A verification
// code cannot be spent on a password, and a reset code cannot be spent on
// proving a number belongs to a signed-in account.

const ResetBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), mobile: pkMobile }),
  z.object({
    action: z.literal('confirm'),
    mobile: pkMobile,
    code: z.string().max(32),
    password: z.string().min(8, 'Use at least 8 characters.').max(200),
  }),
])

export async function POST(request: Request) {
  const parsed = await parseBody(request, ResetBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // A reset request costs an SMS; a confirm is a guess at a code. Separate
  // budgets, same reasoning as the OTP route.
  const bucket = body.action === 'confirm' ? 'otp_verify' : 'otp_send'
  const limit = await rateLimit(bucket, callerIp(request))
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, bucket === 'otp_send' ? 'requests' : 'attempts')
  }

  const msisdn = normalisePkMobile(body.mobile)
  const admin = createAdminClient()

  if (!admin) {
    return NextResponse.json(
      { error: 'Password reset is temporarily unavailable.' },
      { status: 503 },
    )
  }

  // ------------------------------------------------------------- request ---
  if (body.action === 'request') {
    // Always the same answer. Everything below is best-effort and silent.
    if (msisdn) {
      const national = `0${msisdn.slice(2)}`
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
        .limit(1)
        .maybeSingle()

      if (profile) {
        await sendOtp({ phone: msisdn, purpose: 'reset', userId: profile.id as string })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'If that number has an account, a code is on its way.',
    })
  }

  // ------------------------------------------------------------- confirm ---
  if (!msisdn) {
    return NextResponse.json(
      { error: 'No active code for this number. Request a new one.' },
      { status: 400 },
    )
  }

  const result = await verifyOtp({ phone: msisdn, code: body.code, purpose: 'reset' })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft, locked: result.locked },
      { status: result.status },
    )
  }

  if (!result.userId) {
    return NextResponse.json(
      { error: 'No active code for this number. Request a new one.' },
      { status: 400 },
    )
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(result.userId, {
    password: body.password,
  })

  if (updateError) {
    return NextResponse.json(
      { error: 'Could not set the new password. Please try again.' },
      { status: 500 },
    )
  }

  // A temporary password that has now been replaced is no longer temporary.
  // Without this, an imported tutor who reset by SMS would still be forced
  // through the change-password screen with a password they just chose.
  await admin.from('profiles').update({ must_change_password: false }).eq('id', result.userId)

  await logActivity({
    userId: result.userId,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: result.userId,
    meta: { changed: 'password_reset_by_sms' },
  })

  return NextResponse.json({ success: true, message: 'Your password has been changed.' })
}
