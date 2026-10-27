import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { ownerContactGate } from '@/lib/contactWithdrawGate'
import { loadDoNotUseList, removeFromDoNotUse } from '@/lib/contactWithdraw'
import { reasonProblem } from '@/lib/contactWithdrawCore'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, uuid, z } from '@/lib/validate'

// The Do not use list (owner, 27 Oct 2026). The site Owner only.
//   GET                → the live entries, masked.
//   POST { id, reason } → remove one entry (stamped, never deleted); asks for
//                        the password again unless confirmed in the last 5 min.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FRESH_MS = 5 * 60 * 1000

export async function GET() {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'view the Do not use list')
  if (!gate.ok) return gate.response
  return NextResponse.json({ list: await loadDoNotUseList() })
}

const Body = z.object({ id: uuid, reason: z.string().max(600) })

export async function POST(request: Request) {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'remove a number from the Do not use list')
  if (!gate.ok) return gate.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const problem = reasonProblem(parsed.data.reason)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const fresh = await requireFreshAuth(gate.actor.id, FRESH_MS)
  if (!fresh.ok) return fresh.response
  const r = await removeFromDoNotUse({ actor: gate.actor, actorName: gate.name, id: parsed.data.id, reason: parsed.data.reason })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true })
}
