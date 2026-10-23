import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { convertAccount, convertPreview } from '@/lib/convertAccount'
import { parseBody, z, uuid } from '@/lib/validate'

// Convert account type, Parent ↔ Tutor (owner, 23 Oct 2026) — lib/convertAccount.
//
//   GET  ?memberId=<id>   who, to what, and what would block it (in words)
//   POST { memberId, reason, override }
//
// The site Owner ONLY, on both: everyone else gets 403 and the Owner is told
// of the attempt (refuseUnlessOwnerApproval). The change asks for a fresh
// password, like recording a bank payment (requireFreshAuth).

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.convertAccount)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const memberId = new URL(request.url).searchParams.get('memberId') ?? ''
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'change an account type', memberId || null)
  if (notOwner) return notOwner
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return NextResponse.json({ error: 'Choose a member.' }, { status: 400 })
  const preview = await convertPreview(memberId)
  if (!preview) return NextResponse.json({ error: 'Only a tutor or a parent account can be changed.' }, { status: 404 })
  return NextResponse.json(preview)
}

const Body = z.object({ memberId: uuid, reason: z.string().max(600), override: z.boolean().optional() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.convertAccount)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'change an account type', parsed.data.memberId)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const res = await convertAccount({ actor: gate.actor, memberId: parsed.data.memberId, reason: parsed.data.reason, override: !!parsed.data.override })
  if (!res.ok) return NextResponse.json({ error: res.error, needsOverride: res.needsOverride ?? false, blockers: res.blockers ?? [] }, { status: res.status })
  return NextResponse.json({ success: true, to: res.to, emailed: res.emailed })
}
