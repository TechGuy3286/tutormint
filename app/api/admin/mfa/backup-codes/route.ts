import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { regenerateBackupCodes } from '@/lib/adminMfa'
import { logAdminAction } from '@/lib/auditLog'

// Issue a staff member's one-time backup codes, ONCE (PR49 §2). Any signed-in
// staff account may call it for itself; it returns the plaintext codes for the
// screen to show and never again — they are stored hashed, and a fresh set
// cancels the old ones.
//
// Called two ways: at the END OF ENROLMENT (the codes to save), logged
// mfa.enroll; and when a staff member asks for a FRESH set later ({regenerate:
// true}), logged mfa.regenerate. Reaching either point means the authenticator
// is verified.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Any signed-in staff account manages its OWN 2FA (keyed by gate.actor.id
  // below). checkAdminRole() with no args is owner-only, which wrongly denied
  // non-owner staff their backup codes (PR106-H2) — list every staff role so
  // owner/admin/operations/tuitions_staff all qualify.
  const gate = await checkAdminRole('admin', 'operations', 'tuitions_staff')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let regenerate = false
  try {
    const body = (await request.json().catch(() => ({}))) as { regenerate?: unknown }
    regenerate = body?.regenerate === true
  } catch {
    /* no body — first enrolment */
  }

  const codes = await regenerateBackupCodes(gate.actor.id)
  if (!codes) return NextResponse.json({ error: 'Could not create backup codes.' }, { status: 500 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: regenerate ? 'mfa.regenerate' : 'mfa.enroll',
    targetType: 'profile',
    targetId: gate.actor.id,
    detail: { backupCodes: codes.length },
  })

  return NextResponse.json({ codes })
}
