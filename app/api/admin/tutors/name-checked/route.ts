import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z, uuid } from '@/lib/validate'

// "Name checked" (owner, 4 Nov 2026): the Owner compared a tutor's changed name
// with their approved CNIC. Clears the review-queue flag; the name is not
// changed here. Owner only, like every approval.

export const dynamic = 'force-dynamic'

const Body = z.object({ tutorId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { tutorId } = parsed.data

  const notOwner = await refuseUnlessOwnerApproval(gate.actor, "check a tutor's changed name", tutorId)
  if (notOwner) return notOwner

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  const { data: cur } = await admin.from('profiles').select('name_rereview_at, name_rereview_from, full_name').eq('id', tutorId).maybeSingle()
  if (!cur?.name_rereview_at) return NextResponse.json({ success: true, already: true })

  const { error } = await admin.from('profiles').update({ name_rereview_at: null, name_rereview_from: null }).eq('id', tutorId)
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'tutor.name_checked',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { from: cur.name_rereview_from ?? null, to: cur.full_name ?? null },
  })
  return NextResponse.json({ success: true })
}
