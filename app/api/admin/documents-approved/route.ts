import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { documentsApprovedMessage } from '@/lib/documentsApproved'
import { senderRefCode } from '@/lib/staffSignups'

// The "your documents are approved" WhatsApp for one tutor (owner, 15 Oct
// 2026): which template, the filled text and the wa.me link. Read only — the
// click itself is logged through /api/admin/follow-ups (source 'documents').
// Whoever reviews tutor documents may read it (SCREEN_ACCESS.tutors).

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const tutorId = new URL(request.url).searchParams.get('tutorId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(tutorId)) return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  const r = await documentsApprovedMessage(tutorId, await senderRefCode(gate.actor.id))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r, { headers: { 'Cache-Control': 'private, no-store' } })
}
