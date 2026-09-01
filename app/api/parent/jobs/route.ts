import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createJob, updateJob, type JobInput } from '@/lib/jobs'

// Post and edit a tuition.
//
// Every rule lives in lib/jobs.ts (verified-parent gate, quota, is_featured
// stamped from the plan at post time, subjects stored as taxonomy_master ids).
// This file is the HTTP edge: authenticate, parse, hand over, translate the
// result. It never decides anything itself, so the same rules apply whatever
// calls them.

function parseInput(body: Record<string, unknown>): JobInput {
  const masterIds = Array.isArray(body.masterIds)
    ? (body.masterIds as unknown[])
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
    : []

  const budgetRaw = String(body.budgetPkr ?? '').replace(/[^0-9]/g, '')

  const str = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : null
  }

  return {
    title: typeof body.title === 'string' ? body.title : '',
    masterIds: Array.from(new Set(masterIds)),
    classLevel: str(body.classLevel),
    city: str(body.city),
    area: str(body.area),
    teachingMode: str(body.teachingMode),
    budgetPkr: budgetRaw ? Number(budgetRaw) : null,
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const result = await createJob(user.id, parseInput(body))

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade }, { status: result.status })
  }

  return NextResponse.json({ success: true, id: result.id, jobTxId: result.jobTxId })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to edit your job.' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const jobId = typeof body.jobId === 'string' ? body.jobId : ''
  if (!jobId) return NextResponse.json({ error: 'Missing job.' }, { status: 400 })

  const result = await updateJob(user.id, jobId, parseInput(body))

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade }, { status: result.status })
  }

  return NextResponse.json({ success: true })
}
