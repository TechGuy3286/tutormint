import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createTeamJob, type JobInput, type JobOrigin } from '@/lib/jobs'
import { parseBody, z, text, rupees } from '@/lib/validate'

// Post a tuition on the team-operated TutorMint parent account (owner, 9 Sep).
//
// The HTTP edge only: authenticate as an admin who may post, parse the SAME job
// body a parent sends, and hand to createTeamJob. Every rule (validation,
// is_featured from the team plan, subjects as taxonomy_master ids, the audit
// entry) lives in lib/jobs.ts, so a team post is the same job shape as a
// parent's — no second table, no second form contract.
//
// Manager + support (SCREEN_ACCESS.jobsPost): a team post is non-destructive and
// often support-originated. It refuses if the team account is not provisioned
// rather than inventing a recipient.

export const dynamic = 'force-dynamic'

// Mirrors the parent JobBody, plus `origin` (support / referral / external),
// recorded on the audit row. No childId — a team post references no child.
const TeamJobBody = z.object({
  title: text({ min: 1, max: 200, label: 'Title' }),
  masterIds: z.array(z.coerce.number().int().positive()).max(30).default([]),
  classLevel: z.string().max(120).nullish(),
  city: z.string().max(120).nullish(),
  area: z.string().max(120).nullish(),
  teachingMode: z.string().max(60).nullish(),
  budgetPkr: rupees.nullish(),
  budgetMin: rupees.nullish(),
  budgetMax: rupees.nullish(),
  schedule: z.string().max(500).nullish(),
  description: z.string().max(5000, 'Keep the description under 5000 characters.').nullish(),
  origin: z.enum(['support', 'referral', 'external']).nullish(),
  // Optional preferred tutor gender (migration 72). Never required.
  genderPreference: z.enum(['male', 'female', 'trans']).nullish(),
  // The real parent's contact for a seeded tuition (optional). Validated and
  // normalised in createTeamJob; stored in the locked job_contacts table.
  contactName: z.string().max(120).nullish(),
  contactPhone: z.string().max(40).nullish(),
})

function parseInput(body: z.infer<typeof TeamJobBody>): JobInput {
  const str = (v: string | null | undefined) => {
    const s = (v ?? '').trim()
    return s.length > 0 ? s : null
  }

  return {
    title: body.title,
    masterIds: Array.from(new Set(body.masterIds)),
    classLevel: str(body.classLevel),
    city: str(body.city),
    area: str(body.area),
    teachingMode: str(body.teachingMode),
    budgetPkr: body.budgetPkr ?? null,
    budgetMin: body.budgetMin ?? null,
    budgetMax: body.budgetMax ?? null,
    schedule: str(body.schedule),
    description: str(body.description),
    childId: null,
    genderPreference: body.genderPreference ?? null,
    contactName: str(body.contactName),
    contactPhone: str(body.contactPhone),
  }
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, TeamJobBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await createTeamJob(
    parseInput(body),
    { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email },
    (body.origin ?? null) as JobOrigin | null,
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    id: result.id,
    jobTxId: result.jobTxId,
    publicSlug: result.publicSlug,
  })
}
