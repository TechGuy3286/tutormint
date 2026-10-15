import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { recordFollowUp, undoFollowUp } from '@/lib/followUps'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, z, uuid } from '@/lib/validate'

// The shared follow-up record (owner, 9 Oct 2026): record one (a WhatsApp click
// or "Mark as followed up") or undo one. Whoever can work the list can use it —
// Stuck in onboarding / Unpaid signups (SCREEN_ACCESS.unpaidSignups: owner,
// admin, operations, tuitions staff) and Abandoned signups
// (SCREEN_ACCESS.signups). A Partner (view-only) is refused by checkAdminRole,
// like every admin POST.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({
    action: z.literal('record'),
    memberId: uuid,
    channel: z.enum(['whatsapp', 'call', 'email']),
    templateKey: z.string().max(80).nullish(),
    source: z.enum(['stuck', 'unpaid', 'abandoned', 'documents']),
  }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

// 'documents' (owner, 15 Oct 2026): the WhatsApp sent after a tutor's documents
// are approved — whoever reviews tutor documents may log it.
const screenFor = (source: string) =>
  source === 'abandoned' ? SCREEN_ACCESS.signups : source === 'documents' ? SCREEN_ACCESS.tutors : SCREEN_ACCESS.unpaidSignups

export async function POST(request: Request) {
  const gate = await checkAdminRole(...new Set([...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.signups, ...SCREEN_ACCESS.tutors]))
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    const admin = createAdminClient()
    const { data: row } = admin
      ? await admin.from('member_follow_ups').select('source').eq('id', b.id).maybeSingle()
      : { data: null }
    if (!row) return NextResponse.json({ error: 'That follow-up was not found.' }, { status: 404 })
    if (!roleMayWrite(gate.actor.adminRole, screenFor(row.source as string))) {
      return NextResponse.json({ error: 'You do not have access to that list.' }, { status: 403 })
    }
    const res = await undoFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true })
  }

  if (!roleMayWrite(gate.actor.adminRole, screenFor(b.source))) {
    return NextResponse.json({ error: 'You do not have access to that list.' }, { status: 403 })
  }
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: b.channel,
    templateKey: b.templateKey ?? null,
    source: b.source,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id })
}
