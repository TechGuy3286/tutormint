import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelErase, loadPendingErasure, scheduleErase } from '@/lib/accountErase'
import { pendingBannerText, selfDeleteProblem } from '@/lib/accountEraseCore'
import { sendOtp, verifyOtp, maskMsisdn } from '@/lib/otp'
import { callerIp, rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'

// "Delete my account" in Settings (owner, 27 Oct 2026). The member's own
// account only (auth.getUser), never an id in the request.
//
//   GET                         { pending: { dueAt, text } | null, phone (masked) }
//   POST { action: 'send-code' }        a 6-digit code by SMS to their VERIFIED mobile
//   POST { action: 'confirm', code }    the code is right → deletion in 7 days
//   POST { action: 'cancel' }           until the 7 days are up
//
// The same erase as the Owner's runs when the 7 days end (the daily cron).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function me() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select('id, role, admin_role, phone_number, phone_verified_at, erased_at').eq('id', user.id).maybeSingle()
  return p ? { id: user.id, p } : null
}

export async function GET() {
  const who = await me()
  if (!who) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })
  const pending = await loadPendingErasure(who.id)
  return NextResponse.json({
    pending: pending ? { dueAt: pending.due_at, text: pendingBannerText(pending.due_at) } : null,
    phone: who.p.phone_verified_at && who.p.phone_number ? maskMsisdn(who.p.phone_number as string) : null,
  })
}

const Body = z.object({ action: z.enum(['send-code', 'confirm', 'cancel']), code: z.string().max(12).optional() })

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const who = await me()
  if (!who) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })
  const { action } = parsed.data

  if (action === 'cancel') {
    const r = await cancelErase({ memberId: who.id, by: { kind: 'member', id: who.id } })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }

  const problem = selfDeleteProblem({
    phoneVerified: !!who.p.phone_verified_at,
    phone: (who.p.phone_number as string | null) || null,
    isStaff: !!who.p.admin_role,
    erased: !!who.p.erased_at,
  })
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  if (await loadPendingErasure(who.id)) return NextResponse.json({ error: 'Your account is already set to be deleted.' }, { status: 409 })
  const phone = who.p.phone_number as string

  const bucket = action === 'send-code' ? 'otp_send' : 'otp_verify'
  const limit = await rateLimit(bucket, callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, bucket === 'otp_send' ? 'requests' : 'attempts')

  if (action === 'send-code') {
    const r = await sendOtp({ phone, purpose: 'erase', userId: who.id })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true, phone: maskMsisdn(phone) })
  }

  const code = (parsed.data.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  const v = await verifyOtp({ phone, code, purpose: 'erase', userId: who.id })
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })

  const r = await scheduleErase({
    memberId: who.id,
    by: { kind: 'member', id: who.id },
    reason: 'Requested by the member in Settings',
    identityCheck: 'Code sent to the account’s verified mobile',
    mode: 'later',
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, dueAt: r.erasure.due_at, text: pendingBannerText(r.erasure.due_at) })
}
