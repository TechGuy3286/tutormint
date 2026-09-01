import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { findJunkAccounts } from '@/lib/cleanup'

// Delete junk accounts. Owner only.
//
// SCREEN_ACCESS.cleanup is [], which roleSatisfies reads as "owner and nobody
// else" — a manager runs every other admin tool and not this one, because this
// is the only admin action with no undo.
//
// The candidate list is recomputed here rather than trusted from the browser.
// A client posting a list of ids to delete would be a way to delete anything;
// re-running the scan means only accounts that genuinely pass the guards can
// be removed, whatever was submitted.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.cleanup)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let body: { ids?: string[]; confirm?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((i) => typeof i === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 })

  // Typed confirmation. Not theatre: this is the point where somebody who
  // clicked through three screens on autopilot has to stop and read.
  if ((body.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  const { candidates } = await findJunkAccounts()
  const allowed = new Map(candidates.map((c) => [c.id, c]))

  const refused = ids.filter((id) => !allowed.has(id))
  const deletable = ids.filter((id) => allowed.has(id))

  const deleted: { id: string; email: string | null }[] = []
  const failed: { id: string; error: string }[] = []

  for (const id of deletable) {
    const c = allowed.get(id)!
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) failed.push({ id, error: error.message })
    else deleted.push({ id, email: c.email })
  }

  if (deleted.length > 0) {
    await logAdminAction({
      actorId: gate.actor.id,
      actorRole: gate.actor.adminRole,
      actorEmail: gate.actor.email,
      action: 'user.delete',
      targetType: 'auth_users',
      // No single target: the entry names the batch and lists every address,
      // because after deletion the ids resolve to nothing.
      targetId: `${deleted.length} accounts`,
      detail: {
        emails: deleted.map((d) => d.email),
        ids: deleted.map((d) => d.id),
        refused: refused.length,
      },
    })
  }

  return NextResponse.json({
    success: true,
    deleted: deleted.length,
    // An id that no longer qualifies is reported, not silently skipped: it
    // means the account gained data between the scan and the click.
    refused: refused.length,
    failed,
  })
}
