import { NextResponse } from 'next/server'
import { UTM_COOKIE, decodeUtm, hasUtm } from '@/lib/utm'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, looksLikeEmail } from '@/lib/phone'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp } from '@/lib/otp'
import { bridgeStatus } from '@/lib/sms'
import { checkBlocklist } from '@/lib/blocklist'
import { homeForRole } from '@/lib/authRoutes'

// Mobile-first signup.
//
// The account is created HERE rather than in the browser, for three reasons
// the client cannot satisfy:
//
//   1. An account with no email address needs the synthetic one derived from
//      the number (<msisdn>@users.tutormint.org) — the same derivation the
//      bulk import and /api/auth/login use, from the same lib/phone function.
//      If the three ever disagreed by a dash, the member could never sign in
//      and nothing would say why.
//
//   2. The duplicate-mobile check reads profiles across all rows, which the
//      anon key cannot and must not be able to do.
//
//   3. The account is created with the email already confirmed. Every account
//      made here has a mobile, and the mobile is what gets verified — so the
//      confirmation email is not just unnecessary, for a synthetic address it
//      would be a message posted to a domain that accepts no mail. Supabase's
//      "Confirm email" setting is project-wide and cannot make that
//      distinction, so the admin API makes it instead.
//
// The member is signed in immediately and a code is sent to their mobile.
// Until profiles.phone_verified_at is set, proxy.ts holds them on
// /verify-phone. See supabase/migrations/29 for why the gate needs its own
// flag rather than reading phone_verified_at alone.

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
  // GATED UNTIL SMTP (owner, Part 5, 8 Sep). The public pages are indexed now,
  // so real strangers reach /register — and the email path's only verification
  // is a confirmation link that cannot be delivered until SMTP is configured on
  // the Supabase project. An account whose sole way in cannot arrive is a member
  // with no way in and no way out, so the route stops BEFORE creating anything
  // and points them at the mobile path, which works today. This deliberately
  // reverses the Part 4 email branch; re-enable it in the same PR that configures
  // SMTP (the same open owner item password-reset email waits on). The field
  // still accepts an address so the message can explain why.
  if (asEmail) {
    const message = "Email signup isn't available yet. Please sign up with your mobile number."
    return NextResponse.json({ error: message, fields: { identifier: message } }, { status: 400 })
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
  // phone_number has been free text since T3, so the check covers the three
  // shapes it is stored in — the same three /api/auth/login resolves.
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

  // -------------------------------------------------------------- create ---
  // email_confirm: true — a synthetic address accepts no mail, and the mobile
  // is what gets verified. The metadata is read by the on_auth_user_created
  // trigger, which writes profiles (and tutor_profiles for tutors); 'admin' is
  // rejected there, so a signup cannot mint one.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: body.password,
    email_confirm: true,
    user_metadata: { role: body.role, full_name: body.fullName },
  })

  if (createError || !created?.user) {
    const msg = (createError?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return NextResponse.json(
        { error: 'An account with those details already exists. Try signing in instead.' },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: createError?.message ?? 'Could not create the account.' },
      { status: 400 },
    )
  }

  const userId = created.user.id

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      phone_number: mobile,
      email: authEmail,
      phone_gate_required: true,
      ...(hasUtm(utm) ? utm : {}),
    })
    .eq('id', userId)

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json(
      { error: 'Could not finish creating the account. Please try again.' },
      { status: 500 },
    )
  }

  // ------------------------------------------------------------- sign in ---
  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: body.password,
  })

  if (signInError) {
    return NextResponse.json(
      { success: true, signedIn: false, next: '/login', role: body.role },
      { status: 200 },
    )
  }

  // ----------------------------------------------------------- first code ---
  const sent = await sendOtp({ phone: mobile, purpose: 'verify', userId })

  return NextResponse.json({
    success: true,
    signedIn: true,
    role: body.role,
    next: '/verify-phone',
    home: homeForRole(body.role),
    codeSent: sent.ok,
    devBypassActive: sent.ok ? sent.devBypassActive : false,
    codeError: sent.ok ? undefined : sent.error,
  })
}
