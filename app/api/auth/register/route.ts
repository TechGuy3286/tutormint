import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, looksLikeEmail } from '@/lib/phone'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp } from '@/lib/otp'
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
  mobile: pkMobile,
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  // Optional, and genuinely optional: an empty string is not an error.
  email: z
    .string()
    .trim()
    .max(320)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || looksLikeEmail(v), {
      message: 'That email address does not look right.',
    }),
  acceptedTerms: z.literal(true, { message: 'Please accept the terms to continue.' }),
})

export async function POST(request: Request) {
  const limit = await rateLimit('register', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'sign-up attempts')

  const parsed = await parseBody(request, RegisterBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const msisdn = normalisePkMobile(body.mobile)
  if (!msisdn) {
    return NextResponse.json(
      { error: 'Enter a Pakistani mobile number, like 0300 1234567.', fields: { mobile: 'Enter a Pakistani mobile number, like 0300 1234567.' } },
      { status: 400 },
    )
  }

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

  const authEmail = body.email ? body.email.toLowerCase() : syntheticEmail(msisdn)

  // ---------------------------------------------------------- duplicates ---
  // Unlike /api/auth/login, this route DOES say when an identifier is taken.
  // It has to: the alternative is a form that appears to work and produces no
  // account. The disclosure is also the one every signup form on the internet
  // makes, and the member can confirm it themselves by trying to sign in.
  //
  // phone_number has been free text since T3, so the check covers the three
  // shapes it is stored in — the same three /api/auth/login resolves.
  const national = `0${msisdn.slice(2)}`
  const { data: existingPhone } = await admin
    .from('profiles')
    .select('id')
    .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
    .limit(1)
    .maybeSingle()

  if (existingPhone) {
    return NextResponse.json(
      {
        error: 'An account already uses that mobile number.',
        fields: { mobile: 'An account already uses that mobile number. Try signing in instead.' },
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
      {
        error: 'An account already uses that email address.',
        fields: { email: 'An account already uses that email address. Try signing in instead.' },
      },
      { status: 409 },
    )
  }

  // -------------------------------------------------------------- create ---
  // email_confirm: true — see the header. The metadata is read by the
  // on_auth_user_created trigger, which writes profiles (and tutor_profiles
  // for tutors); 'admin' is rejected there, so a signup cannot mint one.
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

  // The trigger writes phone_number as '' because until now the number was
  // collected later, during profile completion. Set the real one, in the
  // canonical form lib/phone defines, and raise the gate.
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      phone_number: msisdn,
      email: authEmail,
      phone_gate_required: true,
    })
    .eq('id', userId)

  if (profileError) {
    // The auth user exists but has no usable profile. Leaving it behind would
    // give the member an account they cannot complete and cannot re-create,
    // because the duplicate check above would then find it.
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json(
      { error: 'Could not finish creating the account. Please try again.' },
      { status: 500 },
    )
  }

  // ------------------------------------------------------------- sign in ---
  // The @supabase/ssr server client writes the session cookies onto the
  // response, so the member is signed in exactly as a client-side sign-in
  // would leave them.
  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: body.password,
  })

  if (signInError) {
    // The account is real and the password is theirs; only the session failed.
    // Send them to /login rather than deleting an account that works.
    return NextResponse.json(
      { success: true, signedIn: false, next: '/login', role: body.role },
      { status: 200 },
    )
  }

  // NOT logged as 'registered' here: the on_auth_user_created trigger
  // (supabase/migrations/14) already writes that row, and it fires for every
  // account however it was made — this route, the bulk import, or somebody
  // adding a user from the Supabase dashboard. Logging it again produced two
  // 'registered' entries on the member's admin timeline, which would have
  // double-counted every signup.

  // ----------------------------------------------------------- first code ---
  // A failure here is not a failed signup: the account exists and the member
  // is signed in. /verify-phone can resend. Saying so is better than rolling
  // back an account over an SMS provider having a bad minute.
  const sent = await sendOtp({ phone: msisdn, purpose: 'verify', userId })

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
