import { NextResponse } from 'next/server'
import { memberUnavailable } from '@/lib/selfPause'
import { NOT_AVAILABLE, NOT_AVAILABLE_UR } from '@/lib/selfPauseCore'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { buildGate } from '@/lib/gate'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { isUnverifiedTutor } from '@/lib/messaging'
import { tutorAtIncomingCap, refuseIncomingRequest, recordIncoming } from '@/lib/incomingRequests'
import { parseBody, z, uuid } from '@/lib/validate'

// A parent asks a tutor for a demo lesson.
//
// Gate (PR25 §4.1): any signed-in PARENT may request a demo, verified or not.
// The old CNIC-verification gate is gone — verification gates POSTING a tuition,
// not messaging/demos/shortlisting. Only a suspended account is refused here.
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

const DemoRequestBody = z.object({
  tutorId: uuid,
  mode: z.enum(['online', 'in_person']).optional(),
  note: z.string().max(1000, 'Keep your note under 1000 characters.').optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Sign in to request a demo.' }, { status: 401 })
  }

  const parsed = await parseBody(request, DemoRequestBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const tutorId = body.tutorId
  if (!tutorId || !/^[0-9a-f-]{36}$/i.test(tutorId)) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }
  // A tutor cannot request a demo with themselves (owner, 5 Oct 2026) — the own
  // card is locked in the UI; this is the rule.
  if (tutorId === user.id) {
    return NextResponse.json({ error: 'You cannot request a demo with yourself.' }, { status: 400 })
  }
  // A tutor who paused their own account (owner, 8 Oct 2026) takes no new demo
  // requests until they sign in again.
  if (await memberUnavailable(tutorId)) {
    return NextResponse.json({ error: `${NOT_AVAILABLE}
${NOT_AVAILABLE_UR}` }, { status: 403 })
  }

  const ent = await getEntitlements(user.id)

  if (ent.audience !== 'parent') {
    return NextResponse.json({ error: 'Only parent accounts can request a demo.' }, { status: 403 })
  }
  // PR25 §4.1 — any signed-in parent, verified or not, may request a demo. The
  // CNIC-verification gate that used to sit here is removed; verification is
  // required only for POSTING a tuition, and Featured only for completing a hire
  // and seeing contact details. Suspension still closes everything.
  if (ent.suspended) {
    return NextResponse.json(
      { error: 'Your account is suspended, so you cannot request a demo. Contact support.' },
      { status: 403 },
    )
  }

  const admin = createAdminClient()

  // Owner (5 Oct 2026): a demo needs CNIC + address approved, exactly like
  // Message (this supersedes PR25 §4.1 for demos). A verified parent holds the
  // free parent_verified plan, which is what `ent.plan` reports. The gate's CTA
  // opens the existing verification step with the way back — the tutor's page
  // with ?demo=1 — so the request resumes once approval has landed. Existing
  // demo requests from unverified parents are untouched.
  if (!ent.plan) {
    const gate = await buildGate('parent_verify', ent)
    let returnTo = '/browse/tutors'
    if (admin) {
      const { data: tp } = await admin.from('tutor_profiles').select('slug').eq('id', tutorId).maybeSingle()
      if (tp?.slug) returnTo = `/tutor/${tp.slug as string}?demo=1`
    }
    return NextResponse.json(
      {
        error: 'Verify your CNIC and address to request a demo. It is free.',
        gate: gate ? { ...gate, href: `/parent/verify?next=${encodeURIComponent(returnTo)}` } : undefined,
      },
      { status: 403 },
    )
  }

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

  // Basic incoming-request limit (PR54 Part B). A Basic or no-plan tutor receives
  // 10 hiring/demo requests a month; over that the request is NOT created, the
  // parent is pointed at similar tutors, and the tutor is nudged to upgrade.
  // Fails open — an unreadable counter never blocks a request.
  if (await tutorAtIncomingCap(tutorId)) {
    const refused = await refuseIncomingRequest(tutorId)
    return NextResponse.json(refused, { status: 403 })
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

  if (error) return serverError(error, 'demo/request')

  // Counted only after it exists — same order as applications.
  await recordIncoming(tutorId)

  // PR16 §2.2 — an unverified tutor is told a parent requested a demo and to
  // verify to see it; details stay hidden until the fee is paid (§2.3). No price.
  const locked = await isUnverifiedTutor(tutorId)
  await notify({
    userId: tutorId,
    kind: 'demo_requested',
    title: 'New demo request',
    body: locked
      ? 'A parent requested a demo. Verify your account to see it.'
      : 'A parent has asked you for a demo lesson.',
    href: locked ? '/tutor/complete-profile?step=verify' : '/tutor/dashboard/demos',
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
