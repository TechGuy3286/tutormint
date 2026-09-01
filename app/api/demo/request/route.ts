import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

// A parent asks a tutor for a free demo class.
//
// Gate: the parent must be verified (CNIC + address approved). That is what
// lib/entitlements.ts returns a plan for -- an unverified parent has no plan
// at all and gets a 403 telling them to finish verification, not a generic
// refusal. Hiding the button is not the control; this check is.
//
// One demo per parent-tutor pair (the owner's rule), so a repeat request on a
// live pair is refused rather than quietly duplicated. A cancelled or declined
// pair may ask again -- the rule is about spamming tutors, not about one
// mistake being final.
//
// The duplicate check reads through the service-role client. demo_requests is
// readable by its participants, so the parent's own client could see their own
// rows -- but reading with the caller's client would make the check depend on
// RLS staying exactly as it is today, and a silent policy change would turn
// "already requested" into "request again". The write itself stays on the
// caller's client so RLS still scopes it.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Sign in to request a demo.' }, { status: 401 })
  }

  let body: { tutorId?: string; mode?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const tutorId = body.tutorId
  if (!tutorId || !/^[0-9a-f-]{36}$/i.test(tutorId)) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }

  const ent = await getEntitlements(user.id)

  if (ent.audience !== 'parent') {
    return NextResponse.json({ error: 'Only parent accounts can request a demo.' }, { status: 403 })
  }
  if (!ent.plan) {
    return NextResponse.json(
      {
        error: 'Verify your CNIC and address before requesting a demo.',
        action: 'verify',
      },
      { status: 403 },
    )
  }

  const admin = createAdminClient()
  if (admin) {
    const { data: existing } = await admin
      .from('demo_requests')
      .select('id, status')
      .eq('parent_id', user.id)
      .eq('tutor_id', tutorId)
      .in('status', ['requested', 'accepted', 'completed'])
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'You have already requested a demo with this tutor.', status: existing.status },
        { status: 409 },
      )
    }
  }

  const { data: created, error } = await supabase
    .from('demo_requests')
    .insert({
      parent_id: user.id,
      tutor_id: tutorId,
      status: 'requested',
      mode: body.mode === 'online' || body.mode === 'in_person' ? body.mode : null,
      note: (body.note ?? '').trim() || null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await notify({
    userId: tutorId,
    kind: 'demo_requested',
    title: 'New demo request',
    body: 'A parent has asked you for a free demo class.',
    href: '/tutor/dashboard',
  })

  await logActivity({
    userId: user.id,
    event: 'demo_requested',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { demoRequestId: created.id, mode: body.mode ?? null },
  })

  return NextResponse.json({ success: true, id: created.id })
}
