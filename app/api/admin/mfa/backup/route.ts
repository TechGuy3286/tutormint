import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { useBackupCode, deleteAllFactors } from '@/lib/adminMfa'
import { logAdminAction } from '@/lib/auditLog'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'

// "Lost your phone? Use a backup code" (PR49 §2). A valid one-time code deletes
// the staff member's authenticator so they set up a fresh one — it does not by
// itself open the panel (GoTrue owns the AAL2 session). Rate-limited like a
// sign-in code, because it is one. Recorded as mfa.backup_used.
export const dynamic = 'force-dynamic'

const Body = z.object({ code: z.string().min(1).max(20) })

export async function POST(request: Request) {
  const gate = await checkAdminRole()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const limit = await rateLimit('otp_verify', `mfa-backup:${gate.actor.id}:${callerIp(request)}`)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'backup-code attempts')

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const okCode = await useBackupCode(gate.actor.id, parsed.data.code)
  if (!okCode) return NextResponse.json({ error: 'That backup code was not right, or has been used.' }, { status: 400 })

  await deleteAllFactors(gate.actor.id)

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'mfa.backup_used',
    targetType: 'profile',
    targetId: gate.actor.id,
  })

  return NextResponse.json({ success: true })
}
