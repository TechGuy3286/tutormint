import { NextResponse } from 'next/server'
import { UTM_COOKIE, decodeUtm, hasUtm } from '@/lib/utm'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, looksLikeEmail } from '@/lib/phone'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { bridgeStatus } from '@/lib/sms'
import { checkBlocklist } from '@/lib/blocklist'
import { ensureProfile } from '@/lib/ensureProfile'
import { startPendingSignup, PENDING_COOKIE } from '@/lib/pendingSignup'
import { CODE_TTL_MS } from '@/lib/otp'

// Signup.
//
// EMAIL PATH: the account is created here (unconfirmed, no session) and Supabase
// sends a confirmation link — see that branch below.
//
// MOBILE PATH (owner, 11 Sep 2026): NOTHING is persisted until the code
// verifies. This route creates no auth user and no profiles row — it stores the
// draft in a short-lived pending_signups row (bcrypt-hashed password) keyed by a
// token in an httpOnly cookie, and sends exactly ONE SMS. The account is created
// only when the code is entered (/api/auth/register/verify). Until then the
// number is free and re-registering is allowed. This lives on the server, not
// the browser, because the synthetic-email derivation, the duplicate check
// across all profiles, and the SMS send all need the service role.
//
// ONE SMS PER NUMBER PER ATTEMPT: if a live code is already outstanding for the
// number this returns alreadySent and sends no second message. The 10-minute
// code TTL is the resend interval.

const RegisterBody = z.object({
  role: z.enum(['tutor', 'parent'], { message: 'Choose whether you are a tutor or a parent.' }),
  fullName: z
    .string()
    .trim()
    .min(2, 'Enter your full name.')
    .max(120, 'That name is too long.'),
  // ONE identifier (owner, Sunday 6 Sep). Digits take the mobile/OTP path, an
  // address takes the email/confirmation-link path. The route decides which.
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your mobile number or email.')
    .max(320),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  acceptedTerms: z.literal(true, { message: 'Please accept the terms to continue.' }),
})

// Neutral message when a signup is refused because the identifier is on the
// ban blocklist. It does not spell out "banned" — that is stated once, at
// login, to the account itself — but it points at support so a genuine mistake
// has a route.
const BLOCKED = 'We could not create an account with these details. If you think this is a mistake, please contact support.'

// The member's profile rows are written AUTHORITATIVELY through the shared
// ensureProfile() (lib/ensureProfile.ts) rather than trusting the
// on_auth_user_created trigger — see that file for the root cause. Same helper
// as staff invites and bulk import, so no auth-user-creating path can silently
// break again if the trigger is ever lost.

export async function POST(request: Request) {
  const limit = await rateLimit('register', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'sign-up attempts')

  const parsed = await parseBody(request, RegisterBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json(
      {
        error: 'Sign-up is temporarily unavailable.',
        detail: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
      },
      { status: 503 },
    )
  }

  const rawId = body.identifier.trim()
  const asEmail = looksLikeEmail(rawId)
  const msisdn = asEmail ? null : normalisePkMobile(rawId)

  if (!asEmail && !msisdn) {
    const message = 'Enter a Pakistani mobile number like 0300 1234567, or an email address.'
    return NextResponse.json({ error: message, fields: { identifier: message } }, { status: 400 })
  }

  const utm = decodeUtm((await cookies()).get(UTM_COOKIE)?.value ?? null)

  // ====================================================== EMAIL PATH ========
  // LIVE AGAIN (owner, Part 8, 9 Sep). The Part 5 gate was explicitly conditional
  // on SMTP — "re-enable the email branch in the same PR that configures SMTP" —
  // and SMTP is now configured (Resend, sender noreply@tutormint.org), so the
  // confirmation link actually delivers. An address takes the confirmation-link
  // path: the account is created UNconfirmed (no session), Supabase sends a link,
  // and the member finishes by clicking it. No phone, so no gate and no OTP. It
  // signs in only after confirmation, so this returns signedIn:false.
  if (asEmail) {
    const authEmail = rawId.toLowerCase()

    const { data: existingEmail } = await admin
      .from('profiles')
      .select('id')
      .eq('email', authEmail)
      .limit(1)
      .maybeSingle()
    if (existingEmail) {
      return NextResponse.json(
        {
          error: 'An account already uses that email address.',
          fields: { identifier: 'An account already uses that email address. Try signing in instead.' },
        },
        { status: 409 },
      )
    }

    // signUp (not admin.createUser) so Supabase sends the confirmation email and
    // leaves the account unconfirmed with no session. The link lands on
    // /api/auth/callback, which exchanges the code for a session, sends the
    // welcome mail once, and forwards on.
    const supabase = await createClient()
    const origin = new URL(request.url).origin
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: authEmail,
      password: body.password,
      options: {
        data: { role: body.role, full_name: body.fullName },
        emailRedirectTo: `${origin}/api/auth/callback`,
      },
    })
    if (signUpError) {
      const msg = signUpError.message.toLowerCase()
      if (msg.includes('already') || msg.includes('registered')) {
        return NextResponse.json(
          { error: 'An account with those details already exists. Try signing in instead.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: signUpError.message }, { status: 400 })
    }

    // Write the profile with the SELECTED role now — the trigger no longer does
    // (see ensureProfile). signUp returns the user id even though the account is
    // unconfirmed, so the role is persisted before the confirmation link is
    // clicked; the callback then routes by that role.
    const uid = signUpData.user?.id
    if (uid) {
      const made = await ensureProfile(admin, {
        userId: uid,
        role: body.role,
        fullName: body.fullName,
        email: authEmail,
        utm: hasUtm(utm) ? utm : undefined,
      })
      if (!made.ok) {
        return NextResponse.json(
          { error: 'Could not finish creating the account. Please try again.' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      signedIn: false,
      role: body.role,
      next: `/verify-email?to=${encodeURIComponent(authEmail)}`,
    })
  }

  // ====================================================== MOBILE PATH =======
  const mobile = msisdn as string

  // Blocklist: a banned person's mobile cannot start a fresh account.
  const blocked = await checkBlocklist({ mobile })
  if (blocked?.mobile) {
    return NextResponse.json({ error: BLOCKED, fields: { identifier: BLOCKED } }, { status: 403 })
  }

  // BRIDGE leash (owner, Part 5): while the shared BRIDGE_OTP code is active,
  // one code verifies every signup, so a tighter per-IP cap sits on top of the
  // ordinary `register` budget. It stops a script minting a batch of
  // bridge-verified accounts on an indexed site — the exact fake-account vector
  // the leash exists to close. Off when the bridge is not active, so a genuine
  // provider deployment is not throttled.
  if (bridgeStatus().active) {
    const bridgeLimit = await rateLimit('register_bridge', callerIp(request))
    if (!bridgeLimit.allowed) return tooManyRequests(bridgeLimit.retryAfterSeconds, 'sign-up attempts')
  }

  const authEmail = syntheticEmail(mobile)

  // ---------------------------------------------------------- duplicates ---
  // Unlike /api/auth/login, this route DOES say when an identifier is taken:
  // the alternative is a form that appears to work and produces no account,
  // and it is the disclosure every signup form makes.
  //
  // This reads REAL profiles only, never pending_signups: a draft awaiting
  // verification must not make the number look taken. phone_number has been
  // free text since T3, so the check covers the three shapes it is stored in —
  // the same three /api/auth/login resolves.
  const national = `0${mobile.slice(2)}`
  const { data: existingPhone } = await admin
    .from('profiles')
    .select('id')
    .or(`phone_number.eq.${mobile},phone_number.eq.${national},phone_number.eq.+${mobile}`)
    .limit(1)
    .maybeSingle()

  if (existingPhone) {
    return NextResponse.json(
      {
        error: 'An account already uses that mobile number.',
        fields: { identifier: 'An account already uses that mobile number. Try signing in instead.' },
      },
      { status: 409 },
    )
  }

  const { data: existingEmail } = await admin
    .from('profiles')
    .select('id')
    .eq('email', authEmail)
    .limit(1)
    .maybeSingle()

  if (existingEmail) {
    return NextResponse.json(
      { error: 'An account with those details already exists. Try signing in instead.' },
      { status: 409 },
    )
  }

  // ---------------------------------------------------- pending signup ---
  // No account is created here. The draft (with a bcrypt-hashed password) goes
  // into a short-lived pending_signups row, ONE SMS is sent, and the account is
  // created only when the code verifies. A live code for the number reuses it
  // and sends nothing.
  const started = await startPendingSignup({
    role: body.role,
    fullName: body.fullName,
    mobile,
    password: body.password,
    utm: hasUtm(utm) ? utm : undefined,
  })

  if (!started.ok) {
    return NextResponse.json({ error: started.error, detail: started.detail }, { status: started.status })
  }

  // The token identifies the draft on /verify-phone. httpOnly and short-lived —
  // it expires with the code, so a dead cookie cannot resurrect a stale draft.
  const jar = await cookies()
  jar.set(PENDING_COOKIE, started.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(CODE_TTL_MS / 1000),
  })

  return NextResponse.json({
    success: true,
    signedIn: false,
    role: body.role,
    next: '/verify-phone',
    // No account exists yet — the client routes to /verify-phone to enter the
    // code, and the account is created there.
    alreadySent: started.alreadySent,
    devBypassActive: started.alreadySent ? false : started.devBypassActive,
  })
}
