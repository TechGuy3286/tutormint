import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import { clearBlankFlags, undoBlankClear } from '@/lib/photoBlank'
import { refreshPipelineBlank } from '@/lib/tutorPipeline'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/photos/looks-fine (owner, 10 Nov 2026) — "Looks fine" on a
// blank-photo flag (People card and Review).
//
//   { action: 'clear', memberId, item }   clears the flag of that member's
//       flagged photo or selfie: who and when are stamped on the check row,
//       which stays. The file is never checked again, so it is not re-flagged.
//   { action: 'undo', memberId, ids }     the Undo — the stamps are emptied on
//       the rows this staff member cleared.
//
// Both are in Audit. Nothing is deleted; no document decision is made.

export const dynamic = 'force-dynamic'

const Item = z.enum(['photo', 'selfie'])
const Body = z.union([
  z.object({ action: z.literal('clear'), memberId: uuid, item: Item }),
  z.object({ action: z.literal('undo'), memberId: uuid, item: Item, ids: z.array(uuid).min(1).max(20) }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blankPhotoClear)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const actor = gate.actor

  if (b.action === 'undo') {
    const res = await undoBlankClear(b.memberId, b.ids, actor.id)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'photo.blank_clear_undo',
      targetType: 'profile',
      targetId: b.memberId,
      detail: { item: b.item, rows: res.count },
    })
    await refreshPipelineBlank(b.memberId)
    return NextResponse.json({ success: true })
  }

  const admin = createAdminClient()
  const { data: me } = admin ? await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle() : { data: null }
  const name = formatName((me?.full_name as string | null) ?? null) || 'Staff'
  const res = await clearBlankFlags(b.memberId, b.item, { id: actor.id, name })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'photo.blank_cleared',
    targetType: 'profile',
    targetId: b.memberId,
    detail: { item: b.item, rows: res.ids.length },
  })
  await refreshPipelineBlank(b.memberId)
  return NextResponse.json({ success: true, ids: res.ids })
}
