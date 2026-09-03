import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { subjectLabels } from '@/lib/jobs'
import { generateJobCopy, type JobSelection } from '@/lib/ai/jobCopy'
import { parseMode } from '@/lib/locations'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// "Write this for me" — a title and description composed from what the parent
// selected, and from nothing else.
//
// SPENDS NO JOB QUOTA. Generating is not posting: a parent who presses it
// twice, reads both and posts neither has used nothing. Quota is consumed in
// createJob when a job actually exists. What this does spend is money, so it
// has its own rate-limit bucket.
//
// THE SUBJECTS ARE RESOLVED HERE, from taxonomy_master ids, not taken as names
// from the browser. The ids are what the parent selected; a name in the
// request body is just a string somebody could put anything in, and it would
// end up in copy published under their own name on a public board.
//
// NOT GATED ON VERIFICATION, deliberately — this writes nothing and publishes
// nothing. The verification gate lives where the job is created, and adding a
// second one here would refuse a parent who is mid-way through their CNIC
// review and drafting a post to have ready.

export const dynamic = 'force-dynamic'

const GenerateBody = z.object({
  masterIds: z.array(z.coerce.number().int().positive()).max(30).default([]),
  level: z.string().max(200).nullish(),
  city: z.string().max(120).nullish(),
  area: z.string().max(120).nullish(),
  teachingMode: z.string().max(60).nullish(),
  budgetMin: z.coerce.number().int().nonnegative().nullish(),
  budgetMax: z.coerce.number().int().nonnegative().nullish(),
  schedule: z.string().max(500).nullish(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Sign in to post a tuition.' }, { status: 401 })
  }

  // Suspension closes this with everything else. A suspended member cannot
  // post, so writing them a post to be refused with is a small cruelty.
  const ent = await getEntitlements(user.id)
  if (ent.suspended) {
    return NextResponse.json(
      { error: 'Your account is suspended. Contact support.' },
      { status: 403 },
    )
  }

  const limit = await rateLimit('ai_generate', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'drafts')

  const parsed = await parseBody(request, GenerateBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const str = (v: string | null | undefined) => {
    const s = (v ?? '').trim()
    return s.length > 0 ? s : null
  }

  const selection: JobSelection = {
    level: str(body.level),
    subjects: await subjectLabels(Array.from(new Set(body.masterIds))),
    city: str(body.city),
    area: str(body.area),
    mode: parseMode(body.teachingMode),
    budgetMin: body.budgetMin ?? null,
    budgetMax: body.budgetMax ?? null,
    schedule: str(body.schedule),
  }

  const copy = await generateJobCopy(selection)

  // `source` and `note` are returned so the form can say, quietly and
  // truthfully, that it wrote this one itself. A fallback presented as a
  // generation is a small lie that costs trust the first time somebody
  // notices the difference in tone.
  return NextResponse.json({
    title: copy.title,
    description: copy.description,
    source: copy.source,
    note: copy.note ?? null,
  })
}
