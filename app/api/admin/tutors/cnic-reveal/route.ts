import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { formatCnic } from '@/lib/cnic'
import { parseBody, z } from '@/lib/validate'

// Reveal a tutor's full CNIC number (owner PR8 §3.3). The queue sends only the
// heavily masked form; the full number is fetched here, once, on an explicit
// "Show" — and every reveal is written to admin_audit_log. Owner + Admin only;
// operations never gets the reveal.

export const runtime = 'nodejs'

const Body = z.object({ tutorId: z.string().min(1) })

export async function POST(request: Request) {
  const gate = await checkAdminRole('admin') // roleSatisfies admits owner too
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })

  const { data } = await admin
    .from('profiles')
    .select('cnic_number, role')
    .eq('id', parsed.data.tutorId)
    .maybeSingle()

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'cnic.reveal',
    targetType: 'tutor',
    targetId: parsed.data.tutorId,
  })

  const cnic = (data?.cnic_number as string | null) ?? null
  return NextResponse.json({ cnicNumber: cnic ? formatCnic(cnic) : null })
}
