import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, looksLikeEmail } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// Sign in with an email address OR a Pakistani mobile number.
//
// Imported tutors were created from a spreadsheet with no email of their own,
// so their credentials are a mobile number and a temporary password. Rather
// than a second login page, /login accepts either and the mapping happens
// here.
//
// WHY SERVER-SIDE. Two reasons, and the second is the important one:
//
//   1. A mobile might belong to an imported account (synthetic address, which
//      is computable) or to somebody who signed up normally and simply knows
//      their own number better than the address they used. Resolving the
//      second needs a lookup the browser must not be able to make.
//
//   2. That lookup must not become an oracle. Every failure below returns the
//      SAME message with the same status, whether the identifier exists, does
//      not exist, or exists with a different password. Otherwise this route
//      would answer "is 0300 1234567 registered on TutorMint?" for anyone who
//      cared to ask, one number at a time.
//
// The only path that says something specific is an unconfirmed email, because
// the member needs to be told to check their inbox and that fact is already
// known to whoever holds the address.

const GENERIC = 'Those sign-in details are not right. Please check and try again.'

const LoginBody = z.object({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  // Rate limited by IP before anything else, including before the body is
  // read. This is the credential-guessing surface, and the cheapest place to
  // stop a script is before it costs a database round trip.
  const limit = await rateLimit('login', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'sign-in attempts')

  // Validated with the SAME generic message as a wrong password, not with the
  // helpful per-field errors used everywhere else. Every other form on the site
  // should say what is wrong with what you typed; this one must not, because
  // "that is not a valid mobile number" and "no account with that number" are
  // two different answers and the difference is the oracle.
  const parsed = await parseBody(request, LoginBody)
  if (!parsed.ok) return NextResponse.json({ error: GENERIC }, { status: 400 })

  const identifier = parsed.data.identifier.trim()
  const password = parsed.data.password

  const email = await resolveEmail(identifier)
  if (!email) return NextResponse.json({ error: GENERIC }, { status: 400 })

  // The @supabase/ssr server client writes the session cookies onto the
  // response, so signing in here leaves the browser signed in exactly as a
  // client-side sign-in would.
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('not confirmed') || msg.includes('confirm')) {
      return NextResponse.json(
        { error: 'Your email address has not been confirmed yet.', needsConfirm: true, email },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: GENERIC }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, must_change_password, is_suspended')
    .eq('id', data.user.id)
    .maybeSingle()

  await logActivity({ userId: data.user.id, event: 'login', meta: { via: looksLikeEmail(identifier) ? 'email' : 'mobile' } })

  return NextResponse.json({
    success: true,
    role: (profile?.role as string) ?? null,
    // The client routes on these rather than guessing: a temporary password
    // has to be replaced before anything else, and a suspended member belongs
    // on the page that explains why.
    mustChangePassword: !!profile?.must_change_password,
    suspended: !!profile?.is_suspended,
  })
}

/**
 * What to hand signInWithPassword.
 *
 * An email is used as typed. A mobile becomes the synthetic address when such
 * an account exists, and otherwise the real address of whoever holds that
 * number. Returns null when it is neither -- and the caller answers with the
 * same message it uses for a wrong password.
 */
async function resolveEmail(identifier: string): Promise<string | null> {
  if (looksLikeEmail(identifier)) return identifier.toLowerCase()

  const msisdn = normalisePkMobile(identifier)
  if (!msisdn) return null

  const synthetic = syntheticEmail(msisdn)

  const admin = createAdminClient()
  if (!admin) return synthetic

  // An imported account, keyed by the number itself.
  const { data: imported } = await admin
    .from('profiles')
    .select('email')
    .eq('email', synthetic)
    .maybeSingle()
  if (imported) return synthetic

  // Otherwise: somebody who registered normally and is signing in with the
  // number they gave us. Matched on the canonical form and on the way it is
  // usually stored locally, since phone_number is free text from T3.
  const national = `0${msisdn.slice(2)}`
  const { data: byPhone } = await admin
    .from('profiles')
    .select('email')
    .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
    .limit(1)
    .maybeSingle()

  return (byPhone?.email as string) ?? synthetic
}
