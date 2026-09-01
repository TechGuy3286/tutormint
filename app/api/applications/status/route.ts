import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setApplicationStatus } from '@/lib/applications'
import { parseBody, z, uuid } from '@/lib/validate'

// Parent-side shortlist / reject / un-shortlist.
//
// Hiring is deliberately NOT reachable from here: it is Featured-only and
// lives at /api/parent/hire, so a plan check can never be skipped by sending
// status='hired' to a route that does not know about plans.

const StatusBody = z.object({
  applicationId: uuid,
  status: z.enum(['shortlisted', 'rejected', 'applied'], {
    message: 'That is not a status we recognise.',
  }),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, StatusBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
