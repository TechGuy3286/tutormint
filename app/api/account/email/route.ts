import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { looksLikeEmail, isSyntheticEmail } from '@/lib/phone'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// Add or change the email on a signed-in account (owner, Sunday 6 Sep — "email
// can be added later in settings"). It becomes a usable sign-in identifier: a
// mobile-first account keeps its synthetic <msisdn>@users address until the
// member sets a real one here.
//
// The member is already authenticated (getUser), so this is the account owner
// setting their own contact address. It is pre-confirmed, the same trust the
// mobile-first signup already places in a synthetic address — the account is
// reachable by mobile regardless, and an unowned address only means receipts go
// nowhere, never a takeover (the password is still required to sign in).

const Body = z.object({ email: z.string().trim().max(320) })

export async function POST(request: Request) {
  const limit = await rateLimit('otp_send', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'requests')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const email = parsed.data.email.trim().toLowerCase()

  if (!looksLikeEmail(email) || isSyntheticEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })

  // Not already another account's.
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

  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true,
  })
  if (authError) {
    return NextResponse.json({ error: 'Could not save that email.' }, { status: 500 })
  }

  await admin.from('profiles').update({ email, email_verified: true }).eq('id', user.id)
  await logActivity({ userId: user.id, event: 'profile_updated', targetType: 'profile', targetId: user.id, meta: { field: 'email' } })

  return NextResponse.json({ success: true })
}
