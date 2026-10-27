import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { addressHash } from '@/lib/email/policy'
import { maskAddress } from '@/lib/email/policyCore'
import { verifyWebhook, webhookAction } from '@/lib/email/webhookCore'

// POST /api/webhooks/resend (owner, 27 Oct 2026) — Resend's delivery events.
//   email.bounced / email.complained → the address goes on the Do not email
//                                       list (hash + masked form only);
//   email.opened                     → email_sends.opened_at (for the
//                                       3-unopened rule).
// OFF until RESEND_WEBHOOK_SECRET is set in Vercel (then 503). A request whose
// signature does not verify is refused 401. Nothing is ever logged but the
// event type.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Not enabled.' }, { status: 503 })
  const body = await request.text()
  const ok = verifyWebhook(
    secret,
    { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body,
    Math.floor(Date.now() / 1000),
  )
  if (!ok) return NextResponse.json({ error: 'Bad signature.' }, { status: 401 })

  let event: unknown = null
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Bad body.' }, { status: 400 })
  }
  const action = webhookAction(event)
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Unavailable.' }, { status: 503 })

  if (action.kind === 'do_not_email') {
    for (const a of action.addresses) {
      const hash = addressHash(a)
      const { data: live } = await admin.from('email_do_not_send').select('id').eq('address_hash', hash).is('removed_at', null).maybeSingle()
      if (!live) await admin.from('email_do_not_send').insert({ address_hash: hash, masked: maskAddress(a), reason: action.reason, event_id: action.emailId })
    }
    const marked = action.addresses.length
    console.info(`[resend-webhook] ${action.reason}: ${marked} marked do not email`)
  } else if (action.kind === 'opened') {
    await admin.from('email_sends').update({ opened_at: new Date().toISOString() }).eq('provider_id', action.emailId).is('opened_at', null)
  }
  return NextResponse.json({ ok: true })
}
