import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { applyRunActions, loadRunReview } from '@/lib/locationRunReview'
import { RUN_BATCH_MAX, type RunAction } from '@/lib/locationRunCore'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { parseBody, z } from '@/lib/validate'

// Admin → Locations → Review added areas (owner, 16 Oct 2026): the rows the
// 16 Oct "Approve all suggestions" run wrote.
//
//   GET ?search=       every live area of any date matching the text
//   GET                the board (open to the roles that open Locations)
//   POST { items }     at most 25 decisions — OWNER ONLY on the server: every
//                      other role gets 403 and the Owner is told of the attempt.
//
// Nothing is deleted; the text on tuitions and profiles is never changed;
// every change is in the Audit log (lib/locationRunReview).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  // ?search=<text>: every live area of any date whose name contains it (owner,
  // 16 Oct 2026), with the same actions as the 16 Oct rows.
  const search = new URL(request.url).searchParams.get('search')?.trim() ?? ''
  if (search && search.length < 2) return NextResponse.json({ error: 'Type at least 2 letters.' }, { status: 400 })
  return NextResponse.json(await loadRunReview(search ? { search } : {}), { headers: { 'Cache-Control': 'private, no-store' } })
}

const id = z.number().int().positive()
const Item = z.union([
  z.object({ kind: z.literal('area'), id, decision: z.literal('keep') }),
  z.object({ kind: z.literal('area'), id, decision: z.literal('merge'), intoAreaId: id }),
  z.object({ kind: z.literal('area'), id, decision: z.literal('split'), intoAreaId: id, landmark: z.string().trim().min(1, 'Type the Block / landmark.').max(120) }),
  z.object({ kind: z.literal('area'), id, decision: z.literal('not_area'), reason: z.enum(['school', 'address', 'online', 'junk']) }),
  z.object({ kind: z.literal('alias'), id, decision: z.literal('keep') }),
  z.object({ kind: z.literal('alias'), id, decision: z.literal('rematch'), areaId: id }),
  z.object({ kind: z.literal('ignored'), id, decision: z.literal('keep') }),
  z.object({ kind: z.literal('ignored'), id, decision: z.literal('actually_area'), name: z.string().trim().min(2, 'Enter the area name.').max(80) }),
  z.object({ kind: z.literal('ignored'), id, decision: z.literal('same_as'), areaId: id }),
])
const Body = z.object({ items: z.array(Item).min(1, 'Choose at least one row.').max(RUN_BATCH_MAX, `Send at most ${RUN_BATCH_MAX} rows at a time.`) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Locations: review the areas added on 16 Oct')
  if (refused) return refused
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const results = await applyRunActions(parsed.data.items as RunAction[], gate.actor)
  const saved = results.filter((r) => r.ok).length
  if (saved === 0) return NextResponse.json({ error: results[0]?.message ?? 'That did not save. Please try again.', results }, { status: 400 })
  return NextResponse.json({ ok: true, saved, failed: results.length - saved, results })
}
