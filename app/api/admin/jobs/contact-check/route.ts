import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, z } from '@/lib/validate'
import { parseContactNumber } from '@/lib/tuitionContactCore'
import { normalisePkMobile } from '@/lib/phone'
import { runContactChecks } from '@/lib/postingChecks'

// POST /api/admin/jobs/contact-check — the live contact check on staff Post a
// tuition and the admin edit (owner, 23 Nov 2026 — PR-18 Part A.3). The form
// asks before Post is enabled; createTeamJob / updateTeamJob run the same check
// again on save (lib/postingChecks), so this is a hint, never the rule. Answers
// the block (withdrawn / erased / on hold), the same-number repeats (TM number,
// title, admin link) and whether the caller may override — never a number.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  phone: z.string().max(40),
  whatsapp: z.string().max(40).nullish(),
  levels: z.array(z.string().max(120)).max(40).default([]),
  masterIds: z.array(z.coerce.number().int().positive()).max(300).default([]),
  jobId: z.guid().nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const number = parseContactNumber(parsed.data.phone)
  if (!number.ok) return NextResponse.json({ error: number.error }, { status: 400 })
  const result = await runContactChecks({
    phone: number.msisdn,
    whatsapp: normalisePkMobile(parsed.data.whatsapp ?? null),
    levels: parsed.data.levels,
    masterIds: parsed.data.masterIds,
    excludeJobId: parsed.data.jobId ?? null,
    isOwner: gate.actor.adminRole === 'owner',
  })
  // An edit is never asked to confirm a repeat (lib/jobs staffContactDecision).
  if (parsed.data.jobId) result.repeats = []
  return NextResponse.json({ result }, { headers: { 'cache-control': 'no-store' } })
}
