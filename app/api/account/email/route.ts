import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { looksLikeEmail, isSyntheticEmail } from '@/lib/phone'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// Add or change the member's email (PR29 §4).
//
// CONFIRMED BY A LINK before it is used (§4.3). This used to set the address
// pre-confirmed (admin updateUserById + email_confirm:true), so an unowned
// address became live immediately. Now supabase.auth.updateUser({ email })
// leaves the account's real email UNCHANGED and emails a confirmation link to
// the NEW address; profiles.email only becomes that address when the link is
// clicked (app/api/auth/callback → syncConfirmedEmail). deliverEmail sends only
// to a real profiles.email, never a synthetic one, so nothing reaches an
// unconfirmed address in the meantime.
//
// Scoped to the signed-in user via the cookie client — a member changes only
// their own email, and Supabase enforces auth-email uniqueness and sends the
// mail. The admin client is used only for the pre-check and the activity log.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ email: z.string().trim().max(320) })

export async function POST(request: Request) {
  // Sending mail costs and can be abused; the same bucket the OTP send uses.
  const limit = await rateLimit('otp_send', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'requests')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

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
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/api/auth/callback` },
  )
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

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
