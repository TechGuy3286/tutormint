import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { mayEditSearchWords } from '@/lib/staffAllRows'
import { addDemand, addMeaning, undoTermAction } from '@/lib/searchTerms'
import { ALIAS_KINDS, DEMAND_KINDS } from '@/lib/searchTermsCore'
import { parseBody, text, z } from '@/lib/validate'

// Admin → Growth → Search words (owner, 24 Nov 2026 — PR-22 Part D).
//   POST { action: 'alias',  term, kind, slug }  "Means the same as…" — a Search word
//   POST { action: 'demand', term, kind, slug }  "Real demand" — on the Overview to-do
//   POST { action: 'undo',   id }                takes either back
// Open to the screen's readers; only the Owner, the Project Managers and the
// account on the 'staff.insights' grant may act (Backend Support reads only).
// Every action is in the Audit log. Terms only — never a user identifier.

export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('alias'), term: text({ min: 2, max: 80, label: 'Search word' }), kind: z.enum(ALIAS_KINDS as [string, ...string[]]), slug: text({ min: 1, max: 120, label: 'Meaning' }) }),
  z.object({ action: z.literal('demand'), term: text({ min: 2, max: 80, label: 'Search word' }), kind: z.enum(DEMAND_KINDS as [string, ...string[]]), slug: text({ min: 1, max: 120, label: 'Wanted' }) }),
  z.object({ action: z.literal('undo'), id: z.number().int().positive() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.searchWords)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!(await mayEditSearchWords(gate.actor))) return NextResponse.json({ error: 'You can view Search words but not change them.' }, { status: 403 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const r =
    b.action === 'alias'
      ? await addMeaning(gate.actor, { term: b.term, kind: b.kind as never, slug: b.slug })
      : b.action === 'demand'
        ? await addDemand(gate.actor, { term: b.term, kind: b.kind as never, slug: b.slug })
        : await undoTermAction(gate.actor, b.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, id: r.id, message: r.message })
}
