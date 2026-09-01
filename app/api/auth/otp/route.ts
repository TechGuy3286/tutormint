import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp, verifyOtp } from '@/lib/otp'
import { normalisePkMobile } from '@/lib/phone'

// Phone / WhatsApp OTP for the SIGNED-IN account.
//
//   POST { action: 'send',   phone }
//   POST { action: 'verify', phone, code }
//
// The rules themselves (expiry, single use, five attempts, cooldown, sends per
// hour) live in lib/otp.ts, because registration and password reset need the
// same ones and three copies would drift. This route is the signed-in door to
// them: it establishes who is asking, rate-limits by IP, and on success writes
// the verification onto the profile.
//
// DEV_DEFAULT_OTP: when set AND this is not the live site, that code verifies,
// so several test users can verify without a live SMS provider and a Vercel
// preview is testable end to end. It is never read on tutormint.org — see
// devOtpCode() in lib/sms, the one place that reads it, and
// instrumentation.ts, which refuses to boot a production server that has it.

const OtpBody = z.object({
  action: z.enum(['send', 'verify'], { message: 'Unknown action.' }),
  phone: pkMobile,
  // Kept loose on purpose: a wrong-length code is a wrong code, and telling
  // somebody their guess was the wrong SHAPE is a hint they did not need.
  code: z.string().max(32).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const parsed = await parseBody(request, OtpBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // Two limits, on purpose. lib/otp caps sends per PHONE per hour, which stops
  // one number being spammed. This caps per IP, which stops one script walking
  // a list of numbers — a different attack, and the one that costs real money.
  //
  // Sends and verifies get separate budgets because they are separate threats:
  // a send costs us money, a verify is a guess at a code.
  const bucket = body.action === 'verify' ? 'otp_verify' : 'otp_send'
  const limit = await rateLimit(bucket, callerIp(request))
  if (!limit.allowed) {
    return tooManyRequests(
      limit.retryAfterSeconds,
      bucket === 'otp_send' ? 'code requests' : 'attempts',
    )
  }

  const phone = normalisePkMobile(body.phone)
  if (!phone) {
    return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })
  }

  // ---------------------------------------------------------------- send ---
  if (body.action === 'send') {
    const result = await sendOtp({ phone, purpose: 'verify', userId: user.id })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail, retryAfterSeconds: result.retryAfterSeconds },
        { status: result.status },
      )
    }

    return NextResponse.json({
      success: true,
      devBypassActive: result.devBypassActive,
      message: result.devBypassActive
        ? 'Development mode: use the configured DEV_DEFAULT_OTP code.'
        : 'Verification code sent.',
    })
  }

  // -------------------------------------------------------------- verify ---
  const result = await verifyOtp({
    phone,
    code: typeof body.code === 'string' ? body.code : '',
    purpose: 'verify',
    userId: user.id,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft, locked: result.locked },
      { status: result.status },
    )
  }

  await supabase
    .from('profiles')
    .update({
      phone_number: phone,
      phone_verified_at: new Date().toISOString(),
      phone_verified: true,
    })
    .eq('id', user.id)

  await recomputeCompletion(user.id)
  await logActivity({
    userId: user.id,
    event: 'otp_verified',
    targetType: 'profile',
    targetId: user.id,
  })

  return NextResponse.json({
    success: true,
    devBypass: result.devBypass,
    message: 'Phone number verified.',
  })
}
