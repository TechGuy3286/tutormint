import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { cancelErase, loadErasure, scheduleErase } from '@/lib/accountErase'
import { ERASE_CONFIRMATION, eraseCountdown, eraseRequestProblem } from '@/lib/accountEraseCore'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, z, uuid } from '@/lib/validate'

// Close account and erase data (owner, 27 Oct 2026) — lib/accountErase.
//
//   GET  ?memberId=<id>   the newest erase request for that account
//   POST { memberId, action: 'schedule', reason, identityCheck, mode: 'later' | 'now' }
//   POST { memberId, action: 'cancel' }
//
// The site Owner ONLY: signed out → 401, every other role → 403 (and the Owner
// is told of the attempt). Scheduling or erasing asks for the password again
// unless it was confirmed in the last 5 minutes.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FRESH_MS = 5 * 60 * 1000

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.convertAccount)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const memberId = new URL(request.url).searchParams.get('memberId') ?? ''
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'close and erase an account', memberId || null)
  if (refused) return refused
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return NextResponse.json({ error: 'Choose a member.' }, { status: 400 })
  const e = await loadErasure(memberId)
  return NextResponse.json({
    erasure: e
      ? {
          status: e.status,
          source: e.source,
          dueAt: e.due_at,
          doneAt: e.done_at,
          countdown: e.status === 'scheduled' ? eraseCountdown(new Date(e.due_at).getTime(), Date.now()) : null,
        }
      : null,
    confirmation: ERASE_CONFIRMATION,
  })
}

const Body = z.object({
  memberId: uuid,
  action: z.enum(['schedule', 'cancel']),
  reason: z.string().max(600).optional(),
  identityCheck: z.string().max(300).optional(),
  mode: z.enum(['later', 'now']).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.convertAccount)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, action } = parsed.data
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'close and erase an account', memberId)
  if (refused) return refused

  const admin = createAdminClient()
  const { data: me } = admin ? await admin.from('profiles').select('full_name').eq('id', gate.actor.id).maybeSingle() : { data: null }
  const by = { kind: 'owner' as const, id: gate.actor.id, name: (me?.full_name as string | null) ?? 'Owner', role: gate.actor.adminRole, email: gate.actor.email }

  if (action === 'cancel') {
    const r = await cancelErase({ memberId, by })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }

  const reason = parsed.data.reason ?? ''
  const identityCheck = parsed.data.identityCheck ?? ''
  const mode = parsed.data.mode ?? 'later'
  const problem = eraseRequestProblem({ reason, identityCheck, mode })
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const fresh = await requireFreshAuth(gate.actor.id, FRESH_MS)
  if (!fresh.ok) return fresh.response

  const r = await scheduleErase({ memberId, by, reason, identityCheck, mode })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({
    success: true,
    ran: r.ran,
    dueAt: r.erasure.due_at,
    emailed: r.emailed ?? false,
    confirmation: r.ran ? ERASE_CONFIRMATION : null,
  })
}
