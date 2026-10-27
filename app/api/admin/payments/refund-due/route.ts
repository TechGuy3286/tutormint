import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadRefundDues, markRefundDone, markRefundDue } from '@/lib/feeMatch'
import { formatName } from '@/lib/formatName'
import { parseBody, z } from '@/lib/validate'

// Refund due (owner, 27 Oct 2026) — lib/feeMatch.ts.
//
//   GET  ?memberId=<id>                         that member's refunds due
//   POST { action: 'due', transferId, memberId, paymentId?, note? }
//        "Mark as duplicate — refund due": a bank credit that paid a fee the
//        member had already paid. Listed on Finance and the member's page
//        until marked refunded.
//   POST { action: 'refunded', id, note? }      mark it refunded
//
// Reading is the Finance screen's (Owner; the Partner views). Every POST is
// OWNER ONLY, asks for a fresh password and is audit-logged.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const memberId = new URL(request.url).searchParams.get('memberId')
  return NextResponse.json({ refunds: await loadRefundDues(memberId ? { memberId } : { openOnly: true }) })
}

const Body = z.union([
  z.object({ action: z.literal('due'), transferId: z.guid(), memberId: z.guid(), paymentId: z.guid().optional().nullable(), note: z.string().max(500).optional().nullable() }),
  z.object({ action: z.literal('refunded'), id: z.guid(), note: z.string().max(500).optional().nullable() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'record a refund due', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient()
  const { data: me } = admin ? await admin.from('profiles').select('full_name').eq('id', gate.actor.id).maybeSingle() : { data: null }
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email, name: formatName((me?.full_name as string | null) ?? null) || null }

  const b = parsed.data
  const r =
    b.action === 'due'
      ? await markRefundDue({ transferId: b.transferId, memberId: b.memberId, paymentId: b.paymentId ?? null, note: b.note ?? null }, actor)
      : await markRefundDone({ id: b.id, note: b.note ?? null }, actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
