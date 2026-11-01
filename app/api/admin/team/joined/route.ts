import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z, uuid } from '@/lib/validate'
import { parseSetDate } from '@/lib/staffTenureCore'
import { formatName } from '@/lib/formatName'

// "Set date" on a Team card whose joining date is not recorded (owner, 2 Nov
// 2026, Part G). Owner only: SCREEN_ACCESS.team is [] and the Partner's view of
// the Team page is read-only (checkAdminRole refuses their POST). Audited
// staff.join_date_set. Only a card with NO record can be set — a recorded
// joining date from the audit log is never overwritten.

export const dynamic = 'force-dynamic'

const Body = z.object({
  staffId: uuid,
  date: z.string().max(10),
  time: z.string().max(5).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') return NextResponse.json({ error: 'Only the Owner can set a joining date.' }, { status: 403 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const iso = parseSetDate(parsed.data.date, parsed.data.time)
  if (!iso) return NextResponse.json({ error: 'Choose a real date that is not in the future.' }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  const { data: staff } = await admin.from('profiles').select('id, role, former_staff_at').eq('id', parsed.data.staffId).maybeSingle()
  if (!staff || (staff.role !== 'admin' && !staff.former_staff_at)) return NextResponse.json({ error: 'That is not a staff account.' }, { status: 404 })

  const [{ data: existing }, { data: joinRow }] = await Promise.all([
    admin.from('staff_tenure').select('source').eq('staff_id', parsed.data.staffId).maybeSingle(),
    admin.from('admin_audit_log').select('id').eq('target_id', parsed.data.staffId).in('action', ['staff.create', 'staff.grant_existing']).limit(1),
  ])
  if ((existing && existing.source !== 'set') || (joinRow ?? []).length > 0) {
    return NextResponse.json({ error: 'This joining date is already recorded and cannot be changed.' }, { status: 409 })
  }

  const { data: me } = await admin.from('profiles').select('full_name').eq('id', gate.actor.id).maybeSingle()
  const { error } = await admin.from('staff_tenure').upsert(
    {
      staff_id: parsed.data.staffId,
      joined_at: iso,
      joined_by: null,
      joined_by_name: null,
      source: 'set',
      set_by: gate.actor.id,
      set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'staff_id' },
  )
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'staff.join_date_set',
    targetType: 'profile',
    targetId: parsed.data.staffId,
    detail: { joinedAt: iso, setBy: formatName((me?.full_name as string | null) ?? null) || null },
  })
  return NextResponse.json({ ok: true, joinedAt: iso })
}
