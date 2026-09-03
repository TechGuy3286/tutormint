import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createJob, updateJob, type JobInput } from '@/lib/jobs'
import { parseBody, z, uuid, text, rupees } from '@/lib/validate'

// Post and edit a tuition.
//
// Every rule lives in lib/jobs.ts (verified-parent gate, quota, is_featured
// stamped from the plan at post time, subjects stored as taxonomy_master ids).
// This file is the HTTP edge: authenticate, parse, hand over, translate the
// result. It never decides anything itself, so the same rules apply whatever
// calls them.

// The job form. Fields are bounded here rather than trusted from the browser:
// a title of ten thousand characters is not a mistake anyone makes by hand.
//
// budgetPkr accepts what people type -- "8000", "8,000", "8k", "Rs 8000" --
// because a parent who writes "8k" in a box labelled Budget has not made an
// error, and rejecting it teaches them nothing.
const JobBody = z.object({
  title: text({ min: 1, max: 200, label: 'Title' }),
  masterIds: z.array(z.coerce.number().int().positive()).max(30).default([]),
  classLevel: z.string().max(120).nullish(),
  city: z.string().max(120).nullish(),
  area: z.string().max(120).nullish(),
  teachingMode: z.string().max(60).nullish(),
  budgetPkr: rupees.nullish(),
  // The budget arrives as a BAND (migration 37). budgetPkr is still accepted
  // for the jobs posted before bands and for any caller that has not moved.
  budgetMin: rupees.nullish(),
  budgetMax: rupees.nullish(),
  schedule: z.string().max(500).nullish(),
  description: z.string().max(5000, 'Keep the description under 5000 characters.').nullish(),
  childId: uuid.nullish(),
  jobId: z.string().max(64).nullish(),
})

function parseInput(body: z.infer<typeof JobBody>): JobInput {
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
    childId: str(body.childId),
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to post a job.' }, { status: 401 })

  const parsed = await parseBody(request, JobBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await createJob(user.id, parseInput(body))

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade, gate: result.gate }, { status: result.status })
  }

  return NextResponse.json({ success: true, id: result.id, jobTxId: result.jobTxId })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to edit your job.' }, { status: 401 })

  const parsed = await parseBody(request, JobBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const jobId = typeof body.jobId === 'string' ? body.jobId : ''
  if (!jobId) return NextResponse.json({ error: 'Missing job.' }, { status: 400 })

  const result = await updateJob(user.id, jobId, parseInput(body))

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade, gate: result.gate }, { status: result.status })
  }

  return NextResponse.json({ success: true })
}
