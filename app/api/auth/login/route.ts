import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, looksLikeEmail } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { needsBridgeReverify } from '@/lib/sms'
import { restoreSelfPauseOnSignIn } from '@/lib/selfPause'
import { PERSIST_COOKIE } from '@/lib/sessionCookies'
import { BANNED_LOGIN_MESSAGE } from '@/lib/authMessages'
import { needsPhoneGate } from '@/lib/phoneGate'
import { accountsOnMobile, linkedRoles } from '@/lib/secondRole'

// The exact banned-login message (owner, Sunday 6 Sep). Shown verbatim, and no
// session is created — the account is signed out again before this returns.
const BANNED_MESSAGE = BANNED_LOGIN_MESSAGE

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
// The plain Urdu line each screen shows beside the English one (PR75 §2).
const GENERIC_UR = 'یہ سائن اِن تفصیلات درست نہیں ہیں۔ براہ کرم جانچ کر دوبارہ کوشش کریں۔'
const NEEDS_CONFIRM_UR = 'سائن اِن کرنے کے لیے براہ کرم اپنے ای میل ایڈریس کی تصدیق کریں۔'
const BANNED_MESSAGE_UR = 'آپ کا اکاؤنٹ فراڈ سرگرمیوں کی وجہ سے بند کر دیا گیا ہے۔ براہ کرم سپورٹ سے رابطہ کریں۔'

const LoginBody = z.object({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
  // Checked by default (persistent session, as before); unchecked means a
  // session cookie only. Optional so older clients keep working.
  rememberMe: z.boolean().optional().default(true),
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
  if (!parsed.ok) return NextResponse.json({ error: GENERIC, errorUr: GENERIC_UR }, { status: 400 })

  const identifier = parsed.data.identifier.trim()
  const password = parsed.data.password
  const rememberMe = parsed.data.rememberMe

  // A mobile can hold up to two LINKED accounts (one tutor, one parent — owner,
  // 8 Oct 2026). Each candidate is tried with the typed password; the first that
  // signs in wins, and the picker below offers the other role.
  const candidates = await resolveEmails(identifier)
  if (candidates.length === 0) return NextResponse.json({ error: GENERIC, errorUr: GENERIC_UR }, { status: 400 })
  let email = candidates[0]

  // Remember the member's choice for later refreshes (proxy + server client
  // read this), and set it BEFORE sign-in so the flag is on the same response
  // that carries the new auth cookies. A session cookie itself — no maxAge — so
  // "not remembered" does not outlive the browser either.
  const jar = await cookies()
  if (rememberMe) jar.delete(PERSIST_COOKIE)
  else jar.set(PERSIST_COOKIE, '0', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })

  // The @supabase/ssr server client writes the session cookies onto the
  // response; sessionOnly strips their maxAge when remember-me is off.
  const supabase = await createClient({ sessionOnly: !rememberMe })
  let { data, error } = await supabase.auth.signInWithPassword({ email, password })
  for (const next of candidates.slice(1)) {
    if (!error) break
    const m = error.message.toLowerCase()
    if (m.includes('confirm')) break
    email = next
    ;({ data, error } = await supabase.auth.signInWithPassword({ email, password }))
  }

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('not confirmed') || msg.includes('confirm')) {
      // The one non-generic login answer, and it is not an oracle: Supabase only
      // returns "not confirmed" when the password is otherwise correct, so a
      // stranger guessing never sees it. Verification follows the identifier the
      // member chose — this is the email path (owner, 9 Sep).
      return NextResponse.json(
        { error: 'Please confirm your email address to sign in.', errorUr: NEEDS_CONFIRM_UR, needsConfirm: true, email },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: GENERIC, errorUr: GENERIC_UR }, { status: 400 })
  }
  if (!data.user) return NextResponse.json({ error: GENERIC, errorUr: GENERIC_UR }, { status: 400 })
  const signedIn = data.user

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, must_change_password, is_suspended, is_banned, phone_verified_via, phone_gate_required, phone_verified_at')
    .eq('id', signedIn.id)
    .maybeSingle()

  // BANNED blocks login with NO session. signInWithPassword already wrote the
  // cookies; sign out again so nothing survives, and answer with the exact
  // message. Unlike the generic oracle, this account IS authenticated, so
  // naming the state is not a membership leak.
  if (profile?.is_banned) {
    await supabase.auth.signOut()
    return NextResponse.json(
      { error: BANNED_MESSAGE, errorUr: BANNED_MESSAGE_UR, banned: true, supportHref: '/support' },
      { status: 403 },
    )
  }

  await logActivity({ userId: signedIn.id, event: 'login', meta: { via: looksLikeEmail(identifier) ? 'email' : 'mobile' } })

  // "Pause my account" (owner, 8 Oct 2026): a successful sign-in brings a
  // self-paused account back — never one staff suspended or banned (the rule
  // is in lib/selfPauseCore shouldRestoreOnSignIn).
  const restored = await restoreSelfPauseOnSignIn(signedIn.id)

  // Bridge re-verification: a number proved by the BRIDGE_OTP stopgap must be
  // re-verified once the real provider lands (owner, Sunday 6 Sep). We detect
  // that here — bridge-verified account, bridge no longer configured — and
  // raise the phone gate again, so proxy.ts routes them to /verify-phone on
  // their next request to prove the number with a real code.
  let reverify = false
  if (needsBridgeReverify(profile?.phone_verified_via as string | null)) {
    const admin = createAdminClient()
    if (admin) {
      await admin
        .from('profiles')
        .update({ phone_verified_at: null, phone_gate_required: true, phone_verified_via: null })
        .eq('id', signedIn.id)
      reverify = true
    }
  }

  // Mobile-first account that has not verified its number yet: hold it at
  // /verify-phone (owner, 9 Sep — verification before the dashboard). The
  // session is kept because /verify-phone needs it to send and enter the code;
  // the client routes there directly so it never lands on a dashboard first.
  // reverify (a bridge number whose bridge was removed) is the same destination.
  const needsPhoneVerify = needsPhoneGate(profile) || reverify

  // Two linked accounts on this mobile → "Continue as Tutor or Parent?".
  const roles = await linkedRoles(signedIn.id)

  return NextResponse.json({
    success: true,
    chooseRole: !!roles && !needsPhoneVerify && !profile?.must_change_password,
    roles: roles ?? undefined,
    role: (profile?.role as string) ?? null,
    // The client routes on these rather than guessing: a temporary password
    // has to be replaced before anything else, and a suspended member belongs
    // on the page that explains why.
    mustChangePassword: !!profile?.must_change_password,
    suspended: !!profile?.is_suspended,
    reverify,
    needsPhoneVerify,
    restored,
  })
}

/**
 * What to hand signInWithPassword, in order.
 *
 * An email is used as typed. A mobile becomes the synthetic address when such
 * an account exists, then the address of every account holding that number
 * (oldest first — up to one tutor and one parent, linked). An empty list is
 * answered with the same message as a wrong password.
 */
async function resolveEmails(identifier: string): Promise<string[]> {
  if (looksLikeEmail(identifier)) return [identifier.toLowerCase()]

  const msisdn = normalisePkMobile(identifier)
  if (!msisdn) return []

  const synthetic = syntheticEmail(msisdn)

  const admin = createAdminClient()
  if (!admin) return [synthetic]

  const out: string[] = []
  // An imported / mobile-first account, keyed by the number itself.
  const { data: imported } = await admin.from('profiles').select('email').eq('email', synthetic).maybeSingle()
  if (imported) out.push(synthetic)

  // Everyone else holding the number (canonical and local shapes).
  for (const a of await accountsOnMobile(msisdn)) {
    if (a.email && !out.includes(a.email)) out.push(a.email)
  }
  if (out.length === 0) out.push(synthetic)
  return out.slice(0, 3)
}
