import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { addStaffArea, approveAreaSuggestion, mergeStaffArea, staffAreaSuggestions } from '@/lib/staffAreas'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/locations/area (owner, 13 Oct 2026)
//
//   add    staff add a new area while posting a tuition — the roles that may
//          post one (SCREEN_ACCESS.jobsPost)
//   merge  "Same as existing area" for an area staff added — OWNER ONLY
//          (owner, 16 Oct 2026: Locations merges are the Owner's), the page
//          itself is open to SCREEN_ACCESS.seo
//   approve_suggestion / approve_all  the suggested merge + Block / landmark
//          split (lib/staffAreas staffAreaSuggestions) — OWNER ONLY
//
// Signed out 401, the wrong role 403. Both are written to the Audit log by
// lib/staffAreas. Nothing is deleted.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), city: z.string().trim().min(1, 'Choose the city first, then add the area.').max(120), name: z.string().trim().min(2, 'Enter the area name.').max(120) }),
  z.object({ action: z.literal('merge'), areaId: z.number().int().positive(), intoAreaId: z.number().int().positive() }),
  z.object({ action: z.literal('approve_suggestion'), areaId: z.number().int().positive() }),
  z.object({ action: z.literal('approve_all') }),
])

export async function POST(request: Request) {
  // The widest of the two is checked first so the body can be read; each action
  // then checks its own role.
  const parsed = await parseBody(request.clone(), Body)
  const action = parsed.ok ? parsed.data.action : 'add'
  const gate = await checkAdminRole(...(action === 'add' ? SCREEN_ACCESS.jobsPost : SCREEN_ACCESS.seo))
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!parsed.ok) return parsed.response

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }
  if (parsed.data.action !== 'add') {
    const refused = await refuseUnlessOwnerApproval(actor, 'Locations: merge an area', parsed.data.action === 'approve_all' ? null : String(parsed.data.areaId))
    if (refused) return refused
  }
  if (parsed.data.action === 'approve_suggestion') {
    const out = await approveAreaSuggestion(parsed.data.areaId, actor)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json({ ok: true, from: out.from, into: out.into, landmark: out.landmark, tuitions: out.tuitions })
  }
  if (parsed.data.action === 'approve_all') {
    const done: { from: string; into: string; landmark: string; tuitions: number }[] = []
    for (const s of await staffAreaSuggestions()) {
      const out = await approveAreaSuggestion(s.areaId, actor)
      if (out.ok) done.push({ from: out.from, into: out.into, landmark: out.landmark, tuitions: out.tuitions })
    }
    return NextResponse.json({ ok: true, approved: done.length, done })
  }
  if (parsed.data.action === 'merge') {
    const out = await mergeStaffArea({ areaId: parsed.data.areaId, intoAreaId: parsed.data.intoAreaId }, actor)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json({ ok: true, from: out.from, into: out.into })
  }
  const out = await addStaffArea({ city: parsed.data.city, name: parsed.data.name }, actor)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ok: true, area: out.area, city: out.city, existed: out.existed })
}
