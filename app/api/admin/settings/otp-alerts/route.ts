import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, uuid, z } from '@/lib/validate'
import { saveOtpAlertSettings } from '@/lib/otpAlerts'

// POST /api/admin/settings/otp-alerts { recipients, digest } — "Who gets OTP
// alerts" (owner, 23 Nov 2026 — PR-18 Part C.2). Owner only: Notification
// settings are on the Owner-only list; the Partner views the page only.

export const dynamic = 'force-dynamic'

const Body = z.object({ recipients: z.array(uuid).max(50), digest: z.boolean() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.notificationSettings)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') return NextResponse.json({ error: 'Only the Owner can change who gets these alerts.' }, { status: 403 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await saveOtpAlertSettings(gate.actor, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true })
}
