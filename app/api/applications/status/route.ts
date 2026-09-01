import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setApplicationStatus } from '@/lib/applications'

// Parent-side shortlist / reject / un-shortlist.
//
// Hiring is deliberately NOT reachable from here: it is Featured-only and
// lives at /api/parent/hire, so a plan check can never be skipped by sending
// status='hired' to a route that does not know about plans.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: { applicationId?: string; status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const status = body.status
  if (status !== 'shortlisted' && status !== 'rejected' && status !== 'applied') {
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
  }
  if (!body.applicationId) {
    return NextResponse.json({ error: 'Missing application.' }, { status: 400 })
  }

  const result = await setApplicationStatus({
    parentId: user.id,
    applicationId: body.applicationId,
    status,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, status })
}
