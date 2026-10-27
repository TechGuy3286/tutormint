import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { ownerContactGate } from '@/lib/contactWithdrawGate'
import { loadHoldList, unpauseContact } from '@/lib/contactWithdraw'
import { reasonProblem } from '@/lib/contactWithdrawCore'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, uuid, z } from '@/lib/validate'

// "Unpause all" and the On hold list (owner, 27 Oct 2026). The site Owner only.
//   GET                   → the numbers on hold, masked.
//   POST { holdId, reason } → every tuition the hold paused goes back to exactly
//                           its earlier state and the hold is lifted; asks for
//                           the password again unless confirmed in the last 5 min.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FRESH_MS = 5 * 60 * 1000

export async function GET() {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'view the numbers on hold')
  if (!gate.ok) return gate.response
  return NextResponse.json({ holds: await loadHoldList() })
}

const Body = z.object({ holdId: uuid, reason: z.string().max(600) })

export async function POST(request: Request) {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'unpause tuitions on hold')
  if (!gate.ok) return gate.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const problem = reasonProblem(parsed.data.reason)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const fresh = await requireFreshAuth(gate.actor.id, FRESH_MS)
  if (!fresh.ok) return fresh.response
  const r = await unpauseContact({ actor: gate.actor, actorName: gate.name, holdId: parsed.data.holdId, reason: parsed.data.reason })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, ...r })
}
