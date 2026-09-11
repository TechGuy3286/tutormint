import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { verifyPendingSignup, PENDING_COOKIE } from '@/lib/pendingSignup'
import { homeForRole, nextForRole } from '@/lib/authRoutes'

// Verify a pending mobile signup — and CREATE THE ACCOUNT.
//
// This is the only place a mobile signup persists anything (owner, 11 Sep 2026).
// The draft lives in a pending_signups row keyed by the httpOnly token cookie;
// the code proves the number; the account is created here with the stored bcrypt
// hash (GoTrue admin password_hash), and the session is minted with a magic-link
// token so no plaintext password is needed to sign the member in.
//
// No session yet, so authorisation is the COOKIE plus the code, and the per-IP
// otp_verify cap (the one that survives removing the per-number caps) stops a
// script guessing codes across attempts.

const Body = z.object({
  // Loose on length: a wrong-length code is just a wrong code.
  code: z.string().min(1).max(32),
  // The page carries the post-signup destination (the AuthGateModal `next`),
  // validated against the role below so it cannot point anywhere unearned.
  next: z.string().max(512).optional(),
})

export async function POST(request: Request) {
  const limit = await rateLimit('otp_verify', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'attempts')

  const jar = await cookies()
  const token = jar.get(PENDING_COOKIE)?.value
  if (!token) {
    return NextResponse.json(
      { error: 'That code has expired. Start over to get a new one.', reason: 'expired' },
      { status: 400 },
    )
  }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await verifyPendingSignup({ token, code: parsed.data.code })

  if (!result.ok) {
    // On a terminal state (expired / locked / blocked / exists) the draft is
    // gone, so clear the cookie too — the screen offers "start over".
    if (result.reason !== 'wrong') jar.delete(PENDING_COOKIE)
    return NextResponse.json(
      { error: result.error, reason: result.reason, attemptsLeft: result.attemptsLeft },
      { status: result.status },
    )
  }

  // The account exists and the number is verified. Consume the cookie.
  jar.delete(PENDING_COOKIE)

  // Mint a session WITHOUT the plaintext password: an admin magic-link token,
  // verified on the cookie-backed client, signs the member in — the same
  // verifyOtp(token_hash) mechanism the staff-invite callback uses.
  let signedIn = false
  const admin = createAdminClient()
  if (admin) {
    const { data: link } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: result.email,
    })
    const tokenHash = link?.properties?.hashed_token
    if (tokenHash) {
      const supabase = await createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      })
      if (!verifyError) signedIn = true
    }
  }

  const dest = nextForRole(parsed.data.next, result.role) ?? homeForRole(result.role)

  // If the session could not be minted, the account is still real — the member
  // signs in with the password they set. Never a dead end.
  return NextResponse.json({
    success: true,
    signedIn,
    role: result.role,
    next: signedIn ? dest : '/login',
  })
}
