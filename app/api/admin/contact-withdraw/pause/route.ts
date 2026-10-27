import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { ownerContactGate } from '@/lib/contactWithdrawGate'
import { pauseContact } from '@/lib/contactWithdraw'
import { parseWithdrawNumber, reasonProblem } from '@/lib/contactWithdrawCore'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z } from '@/lib/validate'

// POST { phone, reason } → "Pause all their tuitions" (lib/contactWithdraw
// pauseContact, owner 27 Oct 2026): pauses every tuition whose own contact
// data holds the number (reversible) and puts the number on hold. The site Owner
// only; asks for the password again unless confirmed in the last 5 minutes.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FRESH_MS = 5 * 60 * 1000
const Body = z.object({ phone: z.string().max(40), reason: z.string().max(600) })

export async function POST(request: Request) {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'pause tuitions on a contact complaint')
  if (!gate.ok) return gate.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const msisdn = parseWithdrawNumber(parsed.data.phone)
  if (!msisdn) return NextResponse.json({ error: 'Enter a Pakistani mobile number, e.g. 0300 1234567.' }, { status: 400 })
  const problem = reasonProblem(parsed.data.reason)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const fresh = await requireFreshAuth(gate.actor.id, FRESH_MS)
  if (!fresh.ok) return fresh.response

  const r = await pauseContact({ actor: gate.actor, actorName: gate.name, msisdn, reason: parsed.data.reason })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, ...r })
}
