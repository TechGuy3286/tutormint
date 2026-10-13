import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { sendConfirmEmail } from '@/lib/emailConfirm'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// POST /api/account/email/resend — "Resend email" on the dashboard reminder
// (owner, 13 Oct 2026). Sends the signed-in member's own confirmation link
// again, to the address on their account. Same budget as the other mail and
// SMS sends.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = await rateLimit('otp_send', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'requests')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  const out = await sendConfirmEmail(user.id, new URL(request.url).origin)
  if (!out.ok) {
    if (out.reason === 'already confirmed') return NextResponse.json({ ok: true, alreadyConfirmed: true })
    return NextResponse.json({ error: 'We could not send the email just now. Please try again in a few minutes.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
