import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { setCityOwner } from '@/lib/cityOwners'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/city-owners (owner, 22 Oct 2026)
//
// Set or clear one city's owner. ONLY the site Owner: SCREEN_ACCESS.cityOwners
// is [] (the Owner; the Partner is admitted to view and refused on writes by
// checkAdminRole), and setCityOwner checks the role again. Audited
// city_owner.set; tuitions the city rule gave that city are re-pointed.

export const dynamic = 'force-dynamic'

const Body = z.object({
  city: z.string().min(1).max(80),
  staffId: uuid.nullable(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.cityOwners)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const result = await setCityOwner({ actor: gate.actor, ...parsed.data })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, reassigned: result.reassigned })
}
