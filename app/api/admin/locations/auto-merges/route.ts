import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadAutoMerges, undoAutoMerge } from '@/lib/locationAutoMerge'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { parseBody, z } from '@/lib/validate'

// Admin → Locations → Automatic merges (owner, 28 Oct 2026).
//
//   GET                       every automatic merge of the clean-up, newest
//                             first (the roles that open Locations)
//   POST { auditId }          Undo one — OWNER ONLY: every other role gets 403
//                             and the Owner is told of the attempt. Audited.
//
// Nothing is deleted: an Undo stamps the spelling row and restores a retired
// area (lib/locationAutoMerge).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json({ items: await loadAutoMerges() })
}

const Body = z.object({ auditId: z.guid() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request.clone(), Body)
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Locations: undo an automatic merge', parsed.ok ? parsed.data.auditId : null)
  if (refused) return refused
  if (!parsed.ok) return parsed.response
  const out = await undoAutoMerge(parsed.data.auditId, gate.actor)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ok: true, message: out.line })
}
