import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { OWNER_ONLY_APPROVAL } from '@/lib/adminAccessCore'
import { createAdminClient } from '@/lib/supabase/admin'
import { refuseOwnerTarget } from '@/lib/ownerGuard'
import { alertOwnerBlocked } from '@/lib/ownerAlerts'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { recordFieldChanges } from '@/lib/fieldHistory'
import { nameEditDecision, cleanName } from '@/lib/nameEditCore'
import { parseBody, z, uuid } from '@/lib/validate'
import { activeStaffNames } from '@/lib/memberNames'

// POST /api/admin/members/name { memberId, name, reason } (owner, 27 Oct 2026).
// Staff change of a tutor's or parent's name. A reason is required; the name is
// stored through formatName; a verified tutor's name (CNIC approved) is the
// Owner's to change (lib/nameEditCore). Every change writes the tutor change
// history (field 'name'), Audit (member.name_edit) and the member's timeline.
//
// TWO NAMES (owner, 5 Nov 2026): { field: 'cnic' | 'display' } — the Name on
// CNIC (Owner only once the CNIC is approved) or the Display name (may be
// empty; refused if it names TutorMint or a staff member, or is offensive).
// profiles.full_name follows by itself (migration 224), and tutor_profiles
// with it.

export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: uuid, name: z.string().max(200), reason: z.string().max(500), field: z.enum(['cnic', 'display']).optional() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutorEdit, ...SCREEN_ACCESS.parents)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, name, reason } = parsed.data
  const field = parsed.data.field ?? 'cnic'

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })

  const ownerRefusal = await refuseOwnerTarget(gate.actor, memberId, "change the Owner account's name")
  if (ownerRefusal) return ownerRefusal

  const { data: p } = await admin.from('profiles').select('id, role, full_name, cnic_name, display_name, cnic_verified_at').eq('id', memberId).maybeSingle()
  if (!p) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })

  // The screen this edit belongs to must be writable by the actor.
  const screen = p.role === 'tutor' ? SCREEN_ACCESS.tutorEdit : SCREEN_ACCESS.parents
  if (!roleMayWrite(gate.actor.adminRole, screen)) {
    return NextResponse.json({ error: 'View only. Your account cannot change this.' }, { status: 403 })
  }

  const decision = nameEditDecision({
    actorRole: gate.actor.adminRole,
    target: {
      role: p.role as string,
      cnicVerifiedAt: p.cnic_verified_at as string | null,
      fullName: (field === 'cnic' ? (p.cnic_name ?? p.full_name) : p.display_name) as string | null,
    },
    name,
    reason,
    field,
    staffNames: field === 'display' ? await activeStaffNames() : [],
  })
  if (!decision.ok) {
    if (decision.status === 403) {
      await alertOwnerBlocked({
        actor: { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email ?? null },
        problem: OWNER_ONLY_APPROVAL,
        what: "change the Name on CNIC of a member whose CNIC is approved",
        targetId: memberId,
      })
    }
    return NextResponse.json({ error: decision.error }, { status: decision.status })
  }
  if (decision.unchanged) return NextResponse.json({ ok: true, unchanged: true, name: decision.name })

  const oldName = cleanName((field === 'cnic' ? (p.cnic_name ?? p.full_name) : p.display_name) as string | null) || null
  const patch = field === 'cnic' ? { cnic_name: decision.name } : { display_name: decision.name || null }
  const { error } = await admin.from('profiles').update(patch).eq('id', memberId)
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })
  // full_name (and tutor_profiles.full_name) follow in the database.
  const { data: shown } = await admin.from('profiles').select('full_name').eq('id', memberId).maybeSingle()
  try {
    await admin.auth.admin.updateUserById(memberId, { user_metadata: { full_name: (shown?.full_name as string | null) ?? decision.name } })
  } catch {
    // The profiles row is the name of record; auth metadata is a mirror.
  }

  await recordFieldChanges([
    {
      tutorId: memberId,
      field: field === 'cnic' ? 'cnic_name' : 'display_name',
      oldValue: oldName,
      newValue: decision.name,
      changedBy: gate.actor.id,
      changedByRole: 'staff',
      changedByEmail: gate.actor.email,
      reason: reason.trim(),
    },
  ])
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: field === 'cnic' ? 'member.cnic_name_edit' : 'member.display_name_edit',
    targetType: 'profile',
    targetId: memberId,
    detail: { from: oldName, to: decision.name, reason: reason.trim() },
  })
  await logActivity({ userId: memberId, event: 'profile_updated', targetType: 'profile', targetId: memberId, meta: { field: field === 'cnic' ? 'cnic_name' : 'display_name', by: 'staff' } })

  return NextResponse.json({ ok: true, name: decision.name, shownName: (shown?.full_name as string | null) ?? null, isTutor: p.role === 'tutor' })
}
