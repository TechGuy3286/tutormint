import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyToJob, withdrawApplication } from '@/lib/applications'

// Apply for a tuition (POST) and withdraw (PATCH).
//
// All five gates -- listed tutor, not blocked, job open, not already applied,
// quota -- live in lib/applications.ts and run here regardless of what the
// page showed. Hiding the Apply button is presentation; this is the control.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to apply.' }, { status: 401 })

  let body: { jobId?: string; message?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.jobId) return NextResponse.json({ error: 'Missing job.' }, { status: 400 })

  const result = await applyToJob({
    tutorId: user.id,
    jobId: body.jobId,
    message: body.message ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade }, { status: result.status })
  }

  return NextResponse.json({ success: true, applicationId: result.applicationId })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: { applicationId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: 'Missing application.' }, { status: 400 })
  }

  const result = await withdrawApplication(user.id, body.applicationId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Said plainly, because it is the part people are surprised by.
  return NextResponse.json({ success: true, quotaRefunded: false })
}
