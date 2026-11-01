import { NextResponse } from 'next/server'
import { requestEmailChange } from '@/lib/emailConfirm'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { looksLikeEmail, isSyntheticEmail } from '@/lib/phone'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'

// Add or change the member's email (PR29 §4).
//
// CONFIRMED BY A LINK before it is used (§4.3). Since 31 Oct 2026 this sends
// ONE TutorMint confirmation to the new address and nothing else
// (lib/emailConfirm requestEmailChange; rules lib/emailChangeCore). It no
// longer calls supabase.auth.updateUser({ email }), whose "Secure email change"
// mailed the old address too — for a mobile sign-up that is the no-mailbox
// placeholder, so every change sent a pair. The sign-in address and
// profiles.email change only when the link is clicked.
//
// Scoped to the signed-in user via the cookie client — a member changes only
// their own email. The admin client is used for the pre-check, the pending
// change and the activity log.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object(
  { email: z.string({ message: RELOAD_AND_RETRY }).trim().max(320, { message: 'Enter a valid email address.' }) },
  { message: RELOAD_AND_RETRY },
)

export async function POST(request: Request) {
  // Sending mail costs and can be abused; the same bucket the OTP send uses.
  const limit = await rateLimit('otp_send', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'requests')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const email = parsed.data.email.toLowerCase()
  if (!looksLikeEmail(email) || isSyntheticEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (user.email && user.email.toLowerCase() === email && !isSyntheticEmail(user.email)) {
    return NextResponse.json({ error: 'That is already your email address.' }, { status: 400 })
  }

  // Not already another account's confirmed address (belt-and-braces; Supabase
  // also rejects a taken auth email below).
  const admin = createAdminClient()
  if (admin) {
    const { data: taken } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .neq('id', user.id)
      .limit(1)
      .maybeSingle()
    if (taken) {
      return NextResponse.json({ error: 'Another account already uses that email.' }, { status: 409 })
    }
  }

  const origin = new URL(request.url).origin
  const out = await requestEmailChange({
    userId: user.id,
    email,
    currentAuthEmail: user.email ?? null,
    appMetadata: (user.app_metadata ?? null) as Record<string, unknown> | null,
    origin,
  })
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: out.status })
  if (!out.sent) return NextResponse.json({ ok: true, pending: email, alreadySent: true })

  // The address is pending until the link is clicked; the confirmation, not this
  // request, is what changes profiles.email. Log the request (not a value change).
  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: user.id,
    meta: { field: 'email', pending: true },
  })

  return NextResponse.json({ ok: true, pending: email })
}
