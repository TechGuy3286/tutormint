import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, uuid } from '@/lib/validate'
import { formatDateTime } from '@/lib/datetime'

// The tutor answers a demo request: accept with a proposed time, or decline
// with a reason.
//
// Demos are free and happen off-platform (Zoom, Meet, WhatsApp or in person),
// so all this route does is agree a time and tell the parent. No plan gates
// it: a demo is how a tutor with no reviews gets their first booking, and
// putting it behind a plan would close that door.

const RespondBody = z.object({
  demoId: uuid,
  action: z.enum(['accept', 'decline'], { message: 'Choose accept or decline.' }),
  proposedTime: z.string().max(64).optional(),
  reason: z.string().max(1000, 'That reason is too long.').optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, RespondBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const { demoId, action } = body
  if (!demoId || (action !== 'accept' && action !== 'decline')) {
    return NextResponse.json({ error: 'Missing demo or unknown action.' }, { status: 400 })
  }

  const { data: demo } = await supabase
    .from('demo_requests')
    .select('id, parent_id, tutor_id, status')
    .eq('id', demoId)
    .maybeSingle()

  if (!demo || demo.tutor_id !== user.id) {
    return NextResponse.json({ error: 'Demo request not found.' }, { status: 404 })
  }
  if (demo.status !== 'requested') {
    return NextResponse.json(
      { error: `This request has already been ${demo.status}.` },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()

  if (action === 'decline') {
    const reason = (body.reason ?? '').trim()
    if (reason.length < 3) {
      return NextResponse.json(
        { error: 'Give the parent a short reason so they know where they stand.' },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from('demo_requests')
      .update({ status: 'declined', responded_at: now, decline_reason: reason })
      .eq('id', demoId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await notify({
      userId: demo.parent_id as string,
      kind: 'demo_declined',
      title: 'A demo request was declined',
      body: reason,
      href: '/parent/dashboard',
    })
    await logActivity({
      userId: user.id,
      event: 'demo_declined',
      targetType: 'demo_request',
      targetId: demoId,
    })

    return NextResponse.json({ success: true, status: 'declined' })
  }

  const proposed = body.proposedTime ? new Date(body.proposedTime) : null
  if (!proposed || Number.isNaN(proposed.getTime())) {
    return NextResponse.json({ error: 'Propose a date and time for the demo.' }, { status: 400 })
  }
  if (proposed.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'Propose a time in the future.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('demo_requests')
    .update({ status: 'accepted', responded_at: now, proposed_time: proposed.toISOString() })
    .eq('id', demoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await notify({
    userId: demo.parent_id as string,
    kind: 'demo_accepted',
    title: 'Your demo was accepted',
    body: `Proposed time: ${formatDateTime(proposed)}`,
    href: '/parent/dashboard',
  })
  await logActivity({
    userId: user.id,
    event: 'demo_accepted',
    targetType: 'demo_request',
    targetId: demoId,
    meta: { proposedTime: proposed.toISOString() },
  })

  return NextResponse.json({
    success: true,
    status: 'accepted',
    proposedTime: proposed.toISOString(),
  })
}
