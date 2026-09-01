import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { closeJob } from '@/lib/jobs'

// Close a job without hiring anyone.
//
// The version this replaced wrote `status: 'awarded'` into the legacy
// parent_jobs table, took the tutor id straight from the request body, and
// never checked that the caller owned the job -- so any signed-in user could
// close anyone's job and name the winner. Ownership is now checked in
// lib/jobs.ts, and awarding is a separate, Featured-only route.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to close your job.' }, { status: 401 })

  let body: { jobId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.jobId) return NextResponse.json({ error: 'Missing job.' }, { status: 400 })

  const result = await closeJob(user.id, body.jobId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true })
}
