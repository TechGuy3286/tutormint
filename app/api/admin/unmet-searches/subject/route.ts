import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { addSubjectFromSearch } from '@/lib/unmetSearches'
import { parseBody, z } from '@/lib/validate'

// Unmet searches → "Add as new subject" (owner, 13 Oct 2026). A subject is
// added only when a staff member presses this — never automatically from a
// search. The roles that manage Subjects (SCREEN_ACCESS.subjectsCore), and they
// must also be able to open Unmet searches; signed out 401. Audited in
// lib/unmetSearches.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  name: z.string().trim().min(2, 'Enter the subject name.').max(80),
  levelSlug: z.string().trim().min(1, 'Choose a level for the new subject.').max(200),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unmetSearches)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.subjectsCore)) {
    return NextResponse.json({ error: 'Your admin role cannot add a subject. Ask an Admin, or add it as a synonym.' }, { status: 403 })
  }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await addSubjectFromSearch(parsed.data, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, subject: result.subject, level: result.level })
}
