import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

// Cancel a demo. Either participant, while it is still requested or accepted.
//
// The version this replaced belonged to a different feature entirely: it took
// a jobTxId, wrote status='cancelled' plus cancellation_reason and
// penalty_applied into the legacy `parent_jobs` table, and computed a
// "late cancellation penalty" from a scheduledTime supplied by the caller --
// with no check that the caller was party to anything. Three problems, in
// increasing order of seriousness: parent_jobs is locked to admin-SELECT-only
// since T1 so it could not have worked; it cancelled a JOB, not a demo; and
// anyone signed in could cancel any job by guessing an id.
//
// The penalty logic is not carried over. There is no penalty rule in the
// business spec for demos -- penalties_log exists and is an admin tool in T7 --
// and inventing a charge in a route is not something to do quietly.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: { demoId?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.demoId) return NextResponse.json({ error: 'Missing demo.' }, { status: 400 })

  const { data: demo } = await supabase
    .from('demo_requests')
    .select('id, parent_id, tutor_id, status')
    .eq('id', body.demoId)
    .maybeSingle()

  if (!demo || (demo.parent_id !== user.id && demo.tutor_id !== user.id)) {
    return NextResponse.json({ error: 'Demo request not found.' }, { status: 404 })
  }
  if (demo.status !== 'requested' && demo.status !== 'accepted') {
    return NextResponse.json(
      { error: `A ${demo.status} demo cannot be cancelled.` },
      { status: 400 },
    )
  }

  const reason = (body.reason ?? '').trim() || null

  const { error } = await supabase
    .from('demo_requests')
    .update({ status: 'cancelled', responded_at: new Date().toISOString(), decline_reason: reason })
    .eq('id', body.demoId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const other = demo.parent_id === user.id ? (demo.tutor_id as string) : (demo.parent_id as string)
  await notify({
    userId: other,
    kind: 'demo_cancelled',
    title: 'A demo was cancelled',
    body: reason,
    href: demo.parent_id === user.id ? '/tutor/dashboard' : '/parent/dashboard',
  })

  await logActivity({
    userId: user.id,
    event: 'demo_declined',
    targetType: 'demo_request',
    targetId: body.demoId,
    meta: { outcome: 'cancelled', reason },
  })

  return NextResponse.json({ success: true, status: 'cancelled' })
}
