import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSmsProvider } from '@/lib/sms'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'

// Phone / WhatsApp OTP.
//
//   POST { action: 'send',   phone }
//   POST { action: 'verify', phone, code }
//
// Rules (all enforced here, not in the UI):
//   * codes expire after 10 minutes (expires_at)
//   * single use (consumed_at)
//   * max 5 attempts per code, then it is burned
//   * 60s resend cooldown
//   * max 5 sends per phone per hour
//
// DEV_DEFAULT_OTP: when set AND NODE_ENV is not production, that code always
// verifies, so several test users can verify without a live SMS provider. It is
// never read in production -- see devOtp() below.
//
// Requires a signed-in user: this verifies the phone of the current account.

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_SENDS_PER_HOUR = 5

/** The dev bypass code, or null in production / when unset. */
function devOtp(): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env.DEV_DEFAULT_OTP
  return v && v.trim() ? v.trim() : null
}

/** Normalise to digits so 0321-4567890 and 03214567890 are the same phone. */
function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[^\d+]/g, '')
  return digits.length >= 10 ? digits : null
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  // phone_otps has RLS on with no policies: it is unreachable with the anon
  // key, so codes cannot be read back by the account they were issued to.
  // All access to it goes through the service-role client, server-side only.
  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable.', detail: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' },
      { status: 503 },
    )
  }

  let body: { action?: string; phone?: string; code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const phone = normalisePhone(body.phone)
  if (!phone) {
    return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })
  }

  // ---------------------------------------------------------------- send ---
  if (body.action === 'send') {
    const now = Date.now()

    const { data: recent } = await admin
      .from('phone_otps')
      .select('created_at')
      .eq('phone', phone)
      .gte('created_at', new Date(now - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })

    if (recent && recent.length >= MAX_SENDS_PER_HOUR) {
      return NextResponse.json(
        { error: 'Too many codes requested for this number. Try again in an hour.' },
        { status: 429 },
      )
    }

    if (recent && recent.length > 0) {
      const since = now - new Date(recent[0].created_at).getTime()
      if (since < RESEND_COOLDOWN_MS) {
        return NextResponse.json(
          {
            error: `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - since) / 1000)}s before requesting another code.`,
            retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000),
          },
          { status: 429 },
        )
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))

    const { error: insertError } = await admin.from('phone_otps').insert({
      phone,
      code,
      user_id: user.id,
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
    })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // With the dev bypass active there is nothing to deliver: the bypass code
    // works regardless, so no SMS is attempted at all.
    const bypass = devOtp()
    if (bypass) {
      return NextResponse.json({
        success: true,
        devBypassActive: true,
        message: 'Development mode: use the configured DEV_DEFAULT_OTP code.',
      })
    }

    const provider = getSmsProvider()
    const sent = await provider.send(phone, `Your TutorMint verification code is ${code}. It expires in 10 minutes.`)

    if (!sent.ok) {
      // Do not claim success when nothing was sent.
      return NextResponse.json(
        { error: 'Could not send the verification code right now.', detail: sent.error },
        { status: 502 },
      )
    }

    return NextResponse.json({ success: true, message: 'Verification code sent.' })
  }

  // -------------------------------------------------------------- verify ---
  if (body.action === 'verify') {
    const submitted = typeof body.code === 'string' ? body.code.trim() : ''
    if (!submitted) {
      return NextResponse.json({ error: 'Enter the verification code.' }, { status: 400 })
    }

    const markVerified = async () => {
      await supabase
        .from('profiles')
        .update({ phone_number: phone, phone_verified_at: new Date().toISOString(), phone_verified: true })
        .eq('id', user.id)
      await recomputeCompletion(user.id)
      await logActivity({ userId: user.id, event: 'otp_verified', targetType: 'profile', targetId: user.id })
    }

    // Dev bypass: accepted without touching the stored code, so several test
    // users can verify from one seed run.
    const bypass = devOtp()
    if (bypass && submitted === bypass) {
      await markVerified()
      return NextResponse.json({ success: true, devBypass: true, message: 'Phone number verified.' })
    }

    const { data: otp } = await admin
      .from('phone_otps')
      .select('id, code, expires_at, consumed_at, attempts')
      .eq('phone', phone)
      // Scoped to this user: you can only verify a code issued to you.
      .eq('user_id', user.id)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!otp) {
      return NextResponse.json({ error: 'No active code for this number. Request a new one.' }, { status: 400 })
    }

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      // Burn it so an expired code cannot be retried.
      await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
      return NextResponse.json({ error: 'That code has expired. Request a new one.' }, { status: 400 })
    }

    if ((otp.attempts ?? 0) >= MAX_ATTEMPTS) {
      await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Request a new code.', locked: true },
        { status: 429 },
      )
    }

    if (otp.code !== submitted) {
      const attempts = (otp.attempts ?? 0) + 1
      const locked = attempts >= MAX_ATTEMPTS
      await admin
        .from('phone_otps')
        .update({ attempts, consumed_at: locked ? new Date().toISOString() : null })
        .eq('id', otp.id)

      return NextResponse.json(
        {
          error: locked
            ? 'Too many incorrect attempts. Request a new code.'
            : `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`,
          attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
          locked,
        },
        { status: locked ? 429 : 400 },
      )
    }

    // Correct: consume it single-use, then mark the phone verified.
    await admin
      .from('phone_otps')
      .update({ consumed_at: new Date().toISOString(), attempts: (otp.attempts ?? 0) + 1 })
      .eq('id', otp.id)

    await markVerified()

    return NextResponse.json({ success: true, message: 'Phone number verified.' })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
