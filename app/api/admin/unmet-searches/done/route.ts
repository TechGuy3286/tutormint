import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { markSearchDone } from '@/lib/unmetSearches'
import { parseBody, z } from '@/lib/validate'

// Unmet searches → "Mark done" (owner, 11 Oct 2026), with an optional note. The
// card moves to the Done tab with who and when; the same search made again later
// makes a new card. Owner, admin, operations (SCREEN_ACCESS.unmetSearches); the
// view-only Partner is refused by checkAdminRole; signed out 401. Audited.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  note: z.string().max(500, 'Keep the note under 500 characters.').optional().nullable(),
  /** 'ignored' = the Ignore button (owner, 13 Oct 2026): hidden from To review, never deleted. */
  kind: z.enum(['done', 'ignored']).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unmetSearches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await markSearchDone({ query: parsed.data.query, note: parsed.data.note ?? null, kind: parsed.data.kind ?? 'done' }, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
