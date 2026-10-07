import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { saveLevelCore } from '@/lib/subjectsCore'
import { parseBody, z } from '@/lib/validate'

// Admin → Settings → Subjects: save a level's "Main subjects" (owner, 7 Oct
// 2026). OWNER AND ADMIN ONLY (SCREEN_ACCESS.subjectsCore) — any other staff
// role gets 403 here. Only the core flag changes; subjects are never added,
// renamed or deleted. Audit-logged in lib/subjectsCore.

export const runtime = 'nodejs'

const Body = z.object({
  levelSlug: z.string().min(1).max(200),
  coreMasterIds: z.array(z.coerce.number().int().positive()).max(1000),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.subjectsCore)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await saveLevelCore(parsed.data.levelSlug, parsed.data.coreMasterIds, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, added: result.added, removed: result.removed })
}
