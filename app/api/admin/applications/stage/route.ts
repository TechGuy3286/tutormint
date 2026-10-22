import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { changeStage } from '@/lib/applicationTracking'
import { STAGES } from '@/lib/applicationStageCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/applications/stage (owner, 22 Oct 2026)
//
// Change one application's stage on Follow-ups → Applications. Screen access is
// SCREEN_ACCESS.applicantForwards; inside it, the Owner changes any stage and
// everyone else only on the tuitions they own (lib/applicationStageCore
// mayEditStage — 403 otherwise). On Hired, `alsoNotSelected` lists the
// tuition's other open applications to close as Not selected (default none).
// The tuition itself is never changed. Every change is audited on the tuition
// and added to the tutor's timeline.

export const dynamic = 'force-dynamic'

const Body = z.object({
  applicationId: uuid,
  stage: z.enum(STAGES),
  alsoNotSelected: z.array(uuid).max(200).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const result = await changeStage({ actor: gate.actor, ...parsed.data })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, changed: result.changed })
}
