import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { requireFreshAuth } from '@/lib/reauth'
import { deleteAllFactors } from '@/lib/adminMfa'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z, uuid } from '@/lib/validate'

// The owner resets another staff member's two-factor (PR49 §2): when they lose
// both their phone and their backup codes. Owner only (SCREEN_ACCESS.team = []),
// behind a password re-entry, because it lets that staff member sign in with a
// fresh authenticator. It deletes their factor and their backup codes; they
// enrol again at their next sign-in. Recorded as mfa.reset.
export const dynamic = 'force-dynamic'

const Body = z.object({ userId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { userId } = parsed.data

  if (userId === gate.actor.id) {
    return NextResponse.json(
      { error: 'To reset your own two-factor, use a backup code on the sign-in screen.' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  // Only reset an actual staff account.
  const { data: target } = await admin.from('profiles').select('role, admin_role, full_name').eq('id', userId).maybeSingle()
  if (target?.role !== 'admin' || !target.admin_role) {
    return NextResponse.json({ error: 'That is not a staff account.' }, { status: 400 })
  }

  await deleteAllFactors(userId)
  await admin.from('admin_backup_codes').delete().eq('user_id', userId)

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'mfa.reset',
    targetType: 'profile',
    targetId: userId,
    detail: { name: target.full_name ?? null },
  })

  return NextResponse.json({ success: true })
}
