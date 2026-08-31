import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'

// Parent verification decisions.
//
//   approve -> cnic_verified_at + address_verified_at set. THIS is what
//              unblocks job posting; /api/parent/jobs reads exactly these two
//              columns, so approval here and the posting gate cannot drift.
//   reject  -> verification_state='rejected' with the reason shown back to the
//              parent on /parent/verify so they know what to fix.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.parents)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions.' }, { status: 503 })
  }

  let body: { parentId?: string; action?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { parentId, action } = body
  const reason = (body.reason ?? '').trim()

  if (!parentId || (action !== 'approve' && action !== 'reject')) {
    return NextResponse.json({ error: 'Missing parent or unknown action.' }, { status: 400 })
  }
  if (reason.length < 3) {
    return NextResponse.json({ error: 'A written reason is required.' }, { status: 400 })
  }

  const { data: parent } = await admin
    .from('profiles')
    .select('id, full_name, role, verification_state')
    .eq('id', parentId)
    .maybeSingle()

  if (!parent) return NextResponse.json({ error: 'Parent not found.' }, { status: 404 })
  if (parent.role !== 'parent' && parent.role !== 'academy') {
    return NextResponse.json({ error: 'That account is not a parent.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch =
    action === 'approve'
      ? {
          verification_state: 'approved',
          cnic_verified_at: now,
          address_verified_at: now,
          verification_rejection_reason: null,
        }
      : {
          verification_state: 'rejected',
          cnic_verified_at: null,
          address_verified_at: null,
          verification_rejection_reason: reason,
        }

  const { error } = await admin.from('profiles').update(patch).eq('id', parentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: `parent.verify.${action}`,
    targetType: 'profile',
    targetId: parentId,
    detail: { reason, from: parent.verification_state, to: patch.verification_state },
  })

  await logActivity({
    userId: parentId,
    event: 'verification_decision_received',
    targetType: 'profile',
    targetId: parentId,
    meta: { decision: action, reason },
  })

  return NextResponse.json({ success: true, action, state: patch.verification_state })
}
