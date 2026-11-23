import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, z } from '@/lib/validate'
import { rateLimit } from '@/lib/rateLimit'
import { extractTuition } from '@/lib/aiTuitionExtract'
import { AI_CAP_REACHED } from '@/lib/aiTuitionExtractCore'

// POST /api/admin/jobs/ai-extract { text } — "Paste a post" on staff Post a
// tuition (owner, 23 Nov 2026 — PR-18 Part A). The browser has already taken
// every number out of the post (lib/postRedactCore) and keeps the parent's
// number itself; this route redacts again, refuses if any number is left, and
// returns the form fields + the ones to check. Nothing is posted, stored or
// logged here (the text never is). 200 calls a day per staff member.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({ text: z.string().min(10, 'Paste the whole post first.').max(6000, 'That post is too long. Paste just the tuition part.') })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.jobsPost)) {
    return NextResponse.json({ error: 'You can view this screen but not post tuitions.' }, { status: 403 })
  }
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const limit = await rateLimit('tuition_ai_fill', gate.actor.id)
  if (!limit.allowed) return NextResponse.json({ error: AI_CAP_REACHED }, { status: 429 })

  const res = await extractTuition(parsed.data.text)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ fill: res.fill }, { headers: { 'cache-control': 'no-store' } })
}
