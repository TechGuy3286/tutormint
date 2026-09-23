import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { regenerateBackupCodes } from '@/lib/adminMfa'
import { logAdminAction } from '@/lib/auditLog'

// Issue a staff member's one-time backup codes, ONCE, at the end of enrolment
// (PR49 §2). Any signed-in staff account may call it for itself; it returns the
// plaintext codes for the screen to show and never again — they are stored
// hashed. Recorded as mfa.enroll, since reaching this point means the
// authenticator is verified.
export const dynamic = 'force-dynamic'

export async function POST() {
  const gate = await checkAdminRole()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const codes = await regenerateBackupCodes(gate.actor.id)
  if (!codes) return NextResponse.json({ error: 'Could not create backup codes.' }, { status: 500 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'mfa.enroll',
    targetType: 'profile',
    targetId: gate.actor.id,
    detail: { backupCodes: codes.length },
  })

  return NextResponse.json({ codes })
}
