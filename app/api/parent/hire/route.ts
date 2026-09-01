import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hireApplicant } from '@/lib/jobs'

// Complete a hire. parent_featured only.
//
// This is the single most valuable thing the Featured plan sells, so the check
// lives in lib/jobs.ts and runs regardless of what the page rendered. A free
// parent gets 403 with an upgrade link, never a silent no-op.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to hire.' }, { status: 401 })

  let body: { applicationId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: 'Missing application.' }, { status: 400 })
  }

  const result = await hireApplicant(user.id, body.applicationId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade }, { status: result.status })
  }

  return NextResponse.json({ success: true, tutorId: result.tutorId })
}
