import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { addSearchWord } from '@/lib/unmetSearches'
import { parseBody, z } from '@/lib/validate'

// Unmet searches → "Add search word" (owner, 11 Oct 2026). Attaches the searched
// text (or an edited form of it) to a subject, school, level or city — the same
// Search words table as Settings → Subjects — then runs the search again and
// answers with what it finds now. Owner, admin, operations
// (SCREEN_ACCESS.unmetSearches); the view-only Partner is refused by
// checkAdminRole; signed out 401. Audited in lib/unmetSearches.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  word: z.string().trim().min(2, 'A search word is 2 to 40 characters long.').max(40, 'A search word is 2 to 40 characters long.'),
  kind: z.enum(['subject', 'school', 'level', 'city']),
  slug: z.string().trim().min(1).max(200),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unmetSearches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await addSearchWord(parsed.data, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, word: result.word, target: result.target, now: result.now })
}
