import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { rateLimit } from '@/lib/rateLimit'
import { normalisePkMobile } from '@/lib/phone'
import { sendSms } from '@/lib/smsLog'
import { maskMobile, scrubSmsError, smsTestBody, smsTestStamp } from '@/lib/smsHealthCore'
import { parseBody, z } from '@/lib/validate'

// "Send test SMS" (owner, 15 Oct 2026). OWNER ONLY: SCREEN_ACCESS.smsHealth is
// `[]`, so checkAdminRole admits the Owner and refuses this POST to the Partner
// (view only) and every other staff role with 403. Five an hour.
//
// The message goes through sendSms() → the same adapter the verification codes
// use (SendPK on the live site), and SendPK's own answer is shown. SendPK sends
// only its approved code template, so the phone shows the template with the
// Pakistan time of the test (HHMMSS) in the code's place — not a code; it
// verifies nothing. Audited with the number masked.

export const runtime = 'nodejs'

const Body = z.object({ phone: z.string().trim().min(1).max(40) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.smsHealth)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const msisdn = normalisePkMobile(parsed.data.phone)
  if (!msisdn) {
    return NextResponse.json({ error: 'Enter a Pakistani mobile number, e.g. 0300 1234567.' }, { status: 400 })
  }

  const limit = await rateLimit('sms_test', gate.actor.id)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'You can send 5 test messages an hour. Please wait and try again.' }, { status: 429 })
  }

  const now = new Date()
  const result = await sendSms({ to: msisdn, body: smsTestBody(now), purpose: 'test', actorId: gate.actor.id })
  const to = maskMobile(msisdn)

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'sms.test',
    targetType: 'sms',
    targetId: to,
    detail: {
      to,
      provider: result.provider,
      ok: result.ok,
      messageId: result.ok ? result.id ?? null : null,
      error: result.ok ? null : scrubSmsError(result.error),
    },
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, to, provider: result.provider, error: scrubSmsError(result.error) ?? 'The message was not sent.' },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true, to, provider: result.provider, messageId: result.id ?? null, stamp: smsTestStamp(now) })
}
