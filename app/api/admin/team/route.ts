import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createStaff, changeStaffRole } from '@/lib/staff'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'

// Staff management. Owner only.
//
// SCREEN_ACCESS.team is [], and roleSatisfies() always admits the owner, so
// this gate is "owner and nobody else" without a special case. A manager --
// who can do everything else in the admin area -- gets 403 here.
//
// Three self-protections, all server-side because the UI hiding a button is
// not a control:
//   * you cannot change your own role
//   * you cannot suspend yourself
//   * the owner row cannot be demoted or suspended by anyone
// Without them an owner is one mis-click from an installation with no owner,
// recoverable only with a SQL session.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  let body: {
    action?: string
    userId?: string
    email?: string
    fullName?: string
    adminRole?: string
    reason?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // ------------------------------------------------------------- create ---
  if (body.action === 'create') {
    const result = await createStaff({
      email: body.email ?? '',
      fullName: body.fullName ?? '',
      adminRole: body.adminRole as AdminRole,
      actor,
      origin: new URL(request.url).origin,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json({
      success: true,
      userId: result.userId,
      invited: result.invited,
      // Shown to the owner once and never stored. Absent when the invite email
      // went out, because then there is no password to pass on.
      temporaryPassword: result.temporaryPassword ?? null,
    })
  }

  // --------------------------------------------------------- change role ---
  if (body.action === 'role') {
    const result = await changeStaffRole({
      userId: body.userId ?? '',
      adminRole: body.adminRole as AdminRole,
      actor,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  // ------------------------------------------------- suspend / reactivate ---
  if (body.action === 'suspend' || body.action === 'reactivate') {
    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

    const userId = body.userId ?? ''
    const reason = (body.reason ?? '').trim()

    if (userId === actor.id) {
      return NextResponse.json(
        { error: 'You cannot suspend your own account.' },
        { status: 400 },
      )
    }
    if (body.action === 'suspend' && reason.length < 5) {
      return NextResponse.json({ error: 'Give a reason for the record.' }, { status: 400 })
    }

    const { data: target } = await admin
      .from('profiles')
      .select('id, role, admin_role, email, full_name')
      .eq('id', userId)
      .maybeSingle()

    if (!target || target.role !== 'admin') {
      return NextResponse.json({ error: 'That is not a staff account.' }, { status: 404 })
    }
    if (target.admin_role === 'owner') {
      return NextResponse.json(
        { error: 'The owner account cannot be suspended.' },
        { status: 403 },
      )
    }

    const suspending = body.action === 'suspend'
    const { error } = await admin
      .from('profiles')
      .update({
        is_suspended: suspending,
        suspension_reason: suspending ? reason : null,
        suspended_at: suspending ? new Date().toISOString() : null,
        suspended_by: suspending ? actor.id : null,
      })
      .eq('id', userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: suspending ? 'staff.suspend' : 'staff.reactivate',
      targetType: 'profile',
      targetId: userId,
      detail: { email: target.email, adminRole: target.admin_role, reason: reason || null },
    })

    await logActivity({
      userId,
      event: suspending ? 'staff_suspended' : 'staff_reactivated',
      targetType: 'profile',
      targetId: userId,
      meta: { reason: reason || null },
    })

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
