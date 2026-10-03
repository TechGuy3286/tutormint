import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z } from '@/lib/validate'
import { ONBOARDING_MODE_KEY } from '@/lib/onboardingMode'

// Set the "New onboarding" rollout switch (PR106-G3 §1). OWNER ONLY (the same
// gate as the payment switches), fresh password required, audit-logged.

export const runtime = 'nodejs'

const Body = z.object({ mode: z.enum(['off', 'staff', 'everyone']) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { mode } = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const { error } = await admin
    .from('app_settings')
    .upsert({ key: ONBOARDING_MODE_KEY, value: mode }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Could not save the setting.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'onboarding.mode',
    targetType: 'app_settings',
    targetId: ONBOARDING_MODE_KEY,
    detail: { mode },
  })

  return NextResponse.json({ ok: true })
}
