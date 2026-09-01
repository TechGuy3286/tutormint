import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { warnMember, suspendMember, unsuspendMember } from '@/lib/moderation'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { requireFreshAuth } from '@/lib/reauth'

// Moderation from the member page, without a report in front of you.
//
// Same three actions as the reports queue and the same implementation, so the
// outcome does not depend on which screen the admin happened to be on. The
// only difference is that nothing here is attached to a report_id.

const MemberActionBody = z.object({
  userId: uuid,
  action: z.enum(['warn', 'suspend', 'unsuspend'], {
    message: 'Choose warn, suspend or unsuspend.',
  }),
  reason: text({ min: 3, max: 1000, label: 'Reason' }),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.users)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  // Suspending somebody closes every door on the platform at once, and
  // reinstating restores a paid plan. Both are worth a password.
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, MemberActionBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const userId = body.userId ?? ''
  const action = body.action ?? ''
  const reason = (body.reason ?? '').trim()

  if (!userId) return NextResponse.json({ error: 'Missing member.' }, { status: 400 })
  if (!['warn', 'suspend', 'unsuspend'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  if (reason.length < 5) {
    return NextResponse.json({ error: 'Write a reason for the record.' }, { status: 400 })
  }

  const result =
    action === 'warn'
      ? await warnMember({ userId, reason, actor })
      : action === 'suspend'
        ? await suspendMember({ userId, reason, actor })
        : await unsuspendMember({ userId, reason, actor })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true, action, alreadyInState: !!result.alreadyInState })
}
