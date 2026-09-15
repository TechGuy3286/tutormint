import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createStaff, changeStaffRole, resendStaffInvite, grantStaffToExisting, searchGrantCandidates } from '@/lib/staff'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, uuid } from '@/lib/validate'
import { requireFreshAuth } from '@/lib/reauth'

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

const TeamBody = z.object({
  action: z.enum(['create', 'role', 'remove', 'resend', 'grant'], { message: 'Unknown action.' }),
  userId: uuid.optional(),
  email: z.string().email('Enter a valid email address.').max(320).optional(),
  fullName: z.string().max(200).optional(),
  adminRole: z.enum(['owner', 'admin', 'operations']).optional(),
  reason: z.string().max(1000).optional(),
  /** grant: the owner has acknowledged the dual-identity warning for a listed tutor. */
  confirmListedTutor: z.boolean().optional(),
})

// Owner-only search for an existing member to grant a role to. A read, so it is
// NOT behind requireFreshAuth (a password prompt per keystroke is absurd); the
// owner gate still applies.
export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const q = new URL(request.url).searchParams.get('q') ?? ''
  const candidates = await searchGrantCandidates(q)
  return NextResponse.json({ candidates })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  // Re-authentication first. Creating staff, changing an admin role and
  // suspending a colleague are all irreversible in the sense that matters:
  // whoever holds this session can hand somebody else the keys. A password
  // confirmation within the last 12 hours is what stands between an unattended
  // browser and a new owner-level account.
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, TeamBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
      // The one-time invite link, ONLY when the email could not be sent, so the
      // owner can pass it on. Absent when the email delivered.
      inviteLink: result.inviteLink ?? null,
    })
  }

  // ------------------------------------------------------------- resend ---
  if (body.action === 'resend') {
    const result = await resendStaffInvite({
      userId: body.userId ?? '',
      actor,
      origin: new URL(request.url).origin,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      success: true,
      invited: result.invited,
      inviteLink: result.inviteLink ?? null,
    })
  }

  // -------------------------------------------------------------- grant ---
  // Grant a staff role to an EXISTING member (no new account, no invite). A
  // listed tutor needs the dual-identity warning confirmed first — the route
  // returns needsConfirm and the client re-submits with confirmListedTutor.
  if (body.action === 'grant') {
    const result = await grantStaffToExisting({
      userId: body.userId ?? '',
      adminRole: body.adminRole as AdminRole,
      confirmListedTutor: body.confirmListedTutor,
      actor,
    })
    if (!result.ok) {
      if ('needsConfirm' in result) {
        return NextResponse.json({ needsConfirm: true, warning: result.warning }, { status: 409 })
      }
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, droppedTutor: result.droppedTutor })
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

  // ------------------------------------------------------------- remove ---
  // Removing a staff member REVOKES the staff role and returns them to an
  // ordinary member (owner, 14 Sep 2026), so they leave the Team list. There is
  // no suspended state and no Reactivate here — re-adding is done through "Add a
  // staff member". The underlying member account is NOT deleted.
  if (body.action === 'remove') {
    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

    const userId = body.userId ?? ''
    const reason = (body.reason ?? '').trim()

    if (userId === actor.id) {
      return NextResponse.json({ error: 'You cannot remove your own staff access.' }, { status: 400 })
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
      return NextResponse.json({ error: 'The owner account cannot be removed.' }, { status: 403 })
    }

    // Revoke the role; return to an ordinary member. Not suspended — an ex-staff
    // member keeps ordinary access. role must be a member role for admin_role to
    // be null under the profiles CHECK constraint.
    const { error } = await admin
      .from('profiles')
      .update({
        admin_role: null,
        role: 'parent',
        is_suspended: false,
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
      })
      .eq('id', userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'staff.remove',
      targetType: 'profile',
      targetId: userId,
      detail: { email: target.email, adminRole: target.admin_role, reason: reason || null },
    })

    await logActivity({
      userId,
      event: 'staff_removed',
      targetType: 'profile',
      targetId: userId,
      meta: { reason: reason || null },
    })

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
