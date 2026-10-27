import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOne } from '@/lib/email/send'
import { addressHash } from '@/lib/email/policy'

// POST /api/internal/webhook-test — the Resend webhook test (owner, 27 Oct 2026),
// the one production exception of that PR. CRON_SECRET-protected.
//
//   { action: 'send' }     ONE email to Resend's bounce test address through the
//                          normal sending path (lib/email/send sendOne).
//   { action: 'status' }   did the webhook mark it "Do not email"? (yes / no)
//   { action: 'cleanup' }  remove that test entry and its log rows — only rows
//                          for this one test address / test template.
//
// Only Resend's own test address is ever touched. Prints counts, never an address.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEST_ADDRESS = 'bounced@resend.dev'
const TEMPLATE = 'webhook_test'

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { action?: string }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const hash = addressHash(TEST_ADDRESS)

  if (body.action === 'send') {
    const { count } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('template', TEMPLATE)
    if ((count ?? 0) > 0) return NextResponse.json({ error: 'A test email was already sent. Clean up first.' }, { status: 409 })
    const r = await sendOne(
      { to: TEST_ADDRESS, subject: 'TutorMint webhook test', text: 'This is a delivery test for the TutorMint bounce webhook.', template: TEMPLATE },
      // The day's 90% hold would park a test email until tomorrow; this one
      // test goes now (the same path a held email takes when it is sent).
      { fromQueue: true },
    )
    return NextResponse.json({ ok: r.ok, providerId: r.ok ? r.id : null, reason: r.ok ? null : r.reason })
  }

  if (body.action === 'status') {
    const [{ data: dnd }, { data: sends }] = await Promise.all([
      admin.from('email_do_not_send').select('id, reason, created_at, removed_at').eq('address_hash', hash),
      admin.from('email_sends').select('id, status, created_at, provider_id').eq('template', TEMPLATE),
    ])
    return NextResponse.json({
      markedDoNotEmail: (dnd ?? []).some((r) => !r.removed_at),
      doNotEmailRows: (dnd ?? []).map((r) => ({ reason: r.reason, at: r.created_at })),
      sends: (sends ?? []).map((s) => ({ status: s.status, at: s.created_at, hasProviderId: !!s.provider_id })),
    })
  }

  if (body.action === 'cleanup') {
    const { data: a } = await admin.from('email_do_not_send').delete().eq('address_hash', hash).select('id')
    const { data: b } = await admin.from('email_sends').delete().eq('template', TEMPLATE).select('id')
    return NextResponse.json({ removedDoNotEmail: (a ?? []).length, removedLogRows: (b ?? []).length })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
