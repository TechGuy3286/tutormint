import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z, text } from '@/lib/validate'
import { PAYMENT_ALERTS_KEY, parseAlertEmails, sendPaymentAlert, paymentAlertEmails } from '@/lib/payments/paymentAlerts'

// Save the "Payment alert emails" list (PR106-H1 §2). OWNER ONLY
// (SCREEN_ACCESS.paymentsSwitches = []), fresh password required, audited.
// Stored in app_settings as a normalised, comma-separated list; invalid entries
// are dropped. The audit records the COUNT, not the addresses.

export const runtime = 'nodejs'

const Body = z.object({
  emails: text({ min: 0, max: 2000, label: 'Emails' }).nullish(),
  test: z.boolean().nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  // "Send a test" — deliver one clearly-marked TEST alert to the saved addresses
  // (no real payment, nothing stored, no setting change). Safe content only.
  if (parsed.data.test) {
    await sendPaymentAlert({
      memberName: 'TEST — no real payment, please ignore',
      role: 'Tutor',
      what: 'TEST payment alert (Verification Fee)',
      amountPkr: 199,
    })
    const to = await paymentAlertEmails()
    return NextResponse.json({ ok: true, test: true, sentTo: to.length })
  }

  const list = parseAlertEmails(parsed.data.emails ?? '')
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const { error } = await admin.from('app_settings').upsert({ key: PAYMENT_ALERTS_KEY, value: list.join(', ') }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Could not save the addresses.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'payments.alert_emails',
    targetType: 'app_settings',
    targetId: PAYMENT_ALERTS_KEY,
    detail: { count: list.length }, // count only — not the addresses
  })

  return NextResponse.json({ ok: true, count: list.length })
}
