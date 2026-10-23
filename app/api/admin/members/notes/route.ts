import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logNote, withdrawNote } from '@/lib/journey'
import { NOTE_KINDS, NOTE_MAX } from '@/lib/journeyCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/members/notes (owner, 23 Oct 2026) — "Log a call or note" on
// a member's Activity tab, and withdrawing one. A note is never edited and
// never deleted: withdrawing keeps it, with who, when and why. The note's words
// are not written to the audit log. Phone numbers, CNIC numbers and emails are
// refused in a note.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('log'), memberId: uuid, kind: z.enum(NOTE_KINDS), body: z.string().max(NOTE_MAX + 100) }),
  z.object({ action: z.literal('withdraw'), noteId: uuid, reason: z.string().max(600) }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberActivity)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const res = b.action === 'log' ? await logNote(gate.actor, b.memberId, b.kind, b.body) : await withdrawNote(gate.actor, b.noteId, b.reason)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, ...('id' in res ? { id: res.id } : {}) })
}
