import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z } from '@/lib/validate'
import {
  activeChangeError,
  gatewayConfigured,
  getGatewaySettings,
  methodChangeError,
  GATEWAY_KEYS,
} from '@/lib/payments/gatewaySettings'

// Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19).
//
// OWNER ONLY — SCREEN_ACCESS.paymentGateways is `[]`, which roleSatisfies()
// admits for the owner alone, so an admin or any staff role gets 403 here
// whatever the page shows. A fresh password is required (the same rule as the
// "open payments" switches). Every change writes admin_audit_log with who, what
// and when. Credentials are never read, accepted or stored by this route.

export const runtime = 'nodejs'

const Body = z.discriminatedUnion('change', [
  z.object({ change: z.literal('active'), gateway: z.enum(['paypro', 'assanpay']) }),
  z.object({ change: z.literal('method'), method: z.enum(['paypro_online', 'bank_transfer']), on: z.boolean() }),
  z.object({ change: z.literal('pay_later'), on: z.boolean() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentGateways)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  }

  const current = await getGatewaySettings()
  let key: string
  let value: string
  let detail: Record<string, unknown>

  if (body.change === 'active') {
    const problem = activeChangeError(body.gateway, gatewayConfigured())
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    key = GATEWAY_KEYS.active
    value = body.gateway
    detail = { change: 'active gateway', from: current.active, to: body.gateway }
  } else if (body.change === 'method') {
    const problem = methodChangeError(current, body.method, body.on)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    key = GATEWAY_KEYS[body.method]
    value = body.on ? 'true' : 'false'
    detail = { change: 'payment method', method: body.method, from: current.methods[body.method], to: body.on }
  } else {
    key = GATEWAY_KEYS.payLater
    value = body.on ? 'true' : 'false'
    detail = { change: 'pay later', from: current.payLater, to: body.on }
  }

  const { error } = await admin
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: gate.actor.id }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'payments.gateway',
    targetType: 'app_settings',
    targetId: key,
    detail,
  })

  return NextResponse.json({ ok: true })
}
