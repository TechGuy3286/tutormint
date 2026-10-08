import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { resumeTuitionsAsStaff } from '@/lib/pausedTuitions'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/jobs/paused — Resume one or many auto-paused tuitions
// (owner, 8 Oct 2026). Every role that can post tuitions; the Partner is refused
// (view-only) inside checkAdminRole.

const Body = z.object({ ids: z.array(z.guid()).min(1).max(500) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.pausedTuitions)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { resumed, skipped } = await resumeTuitionsAsStaff(gate.actor, parsed.data.ids)
  return NextResponse.json({ success: true, resumed: resumed.length, skipped: skipped.length })
}
