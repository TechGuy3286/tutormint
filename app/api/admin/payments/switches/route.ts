import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z } from '@/lib/validate'
import { SWITCH_KEYS } from '@/lib/payments/switches'

// Toggle the two "open payments" switches (PR105 §1). OWNER ONLY, fresh password
// required. Each change is audit-logged (who, when, which switch, on/off).

export const runtime = 'nodejs'

const Body = z.object({
  which: z.enum(['fee_open', 'plans_open']),
  on: z.boolean(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { which, on } = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const key = which === 'fee_open' ? SWITCH_KEYS.feeOpen : SWITCH_KEYS.plansOpen
  const { error } = await admin
    .from('app_settings')
    .upsert({ key, value: on ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Could not save the switch.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'payments.switch',
    targetType: 'app_settings',
    targetId: key,
    detail: { which, on },
  })

  return NextResponse.json({ ok: true })
}
