import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, uuid } from '@/lib/validate'
import { formatDateTime } from '@/lib/datetime'
import { detectAbuse } from '@/lib/abuse/filter'
import { flagIfAbusive } from '@/lib/abuse/flag'
import { tutorTextToParent, DEMO_DECLINE_FIXED } from '@/lib/tutorMessagingCore'

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

  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

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

    // What the parent is told (owner, 11 Nov 2026). An UNVERIFIED tutor's typed
    // reason is never delivered — a free-text decline is a message to a parent,
    // and messaging parents needs the Verification Fee. A reason with a banned
    // word is never delivered either: it is flagged and withheld. In both cases
    // the parent gets one fixed, neutral line.
    const entD = await getEntitlements(user.id)
    const abusive = detectAbuse(reason).length > 0
    const delivered = tutorTextToParent({ verified: entD.verified, abusive })
    if (abusive) {
      try {
        await flagIfAbusive({ source: 'message', subjectId: user.id, recipientId: demo.parent_id as string, content: reason, context: { demoId, field: 'decline_reason' }, withheld: true })
      } catch {
        /* the reason is withheld whatever the flag write does */
      }
    }
    const shown = delivered ? reason : DEMO_DECLINE_FIXED

    const { error } = await supabase
      .from('demo_requests')
      .update({ status: 'declined', responded_at: now, decline_reason: shown })
      .eq('id', demoId)
    if (error) return serverError(error, 'demo/respond')

    await notify({
      userId: demo.parent_id as string,
      kind: 'demo_declined',
      title: 'A demo request was declined',
      body: shown,
      href: '/parent/dashboard/demos',
    })
    await logActivity({
      userId: user.id,
      event: 'demo_declined',
      targetType: 'demo_request',
      targetId: demoId,
    })

    return NextResponse.json({ success: true, status: 'declined', reasonSent: delivered })
  }

  // ACCEPTING (and seeing the demo's details) requires the verification fee
  // (PR16 §1.2/§2.3): an unverified tutor may receive a demo request but cannot
  // act on it until they verify. Declining is never gated (handled above). No
  // modal here — the dashboard shows this plain reason and a verify link.
  const ent = await getEntitlements(user.id)
  // A rejected document pauses accepting demos too (PR106-H4 §2).
  if (ent.docRejected && ent.rejectedDoc) {
    return NextResponse.json(
      { error: `Please upload a correct ${ent.rejectedDoc.label} to continue.`, reuploadHref: ent.reuploadHref ?? '/tutor/dashboard/settings#identity' },
      { status: 403 },
    )
  }
  if (!ent.verified) {
    return NextResponse.json({ error: 'Verify your account to accept demo requests.' }, { status: 403 })
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
  if (error) return serverError(error, 'demo/respond')

  await notify({
    userId: demo.parent_id as string,
    kind: 'demo_accepted',
    title: 'Your demo was accepted',
    body: `Proposed time: ${formatDateTime(proposed)}`,
    href: '/parent/dashboard/demos',
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
