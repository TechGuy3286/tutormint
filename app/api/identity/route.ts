import { NextResponse } from 'next/server'

import { logActivity } from '@/lib/activityLog'
import { formatCnic, isValidCnic, CNIC_FORMAT_HINT } from '@/lib/cnic'
import { recomputeCompletion } from '@/lib/completion'
import { loadIdentity } from '@/lib/identity'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'

// The identity card's three writes, for either role.
//
// ROLE-NEUTRAL ON PURPOSE. /api/parent/verify exists and is parent-only, which
// is why tutors grew a second, worse flow that wrote their CNIC to a public
// bucket. A CNIC is a CNIC; the card is the same card; this is the one route
// that takes it.
//
// It never sets cnic_verified_at. Approval is an admin action in the two
// queues, and a route a member can call must not be able to verify them --
// that is the same line /api/parent/verify draws and it is drawn here again
// because this route is reachable by more people.

export const dynamic = 'force-dynamic'

// GET, for the client-rendered tutor settings page.
//
// The two dashboards are server components and call loadIdentity() directly.
// The settings page is 'use client' and loads everything it shows through the
// browser Supabase client, so it needs the same shape over HTTP rather than a
// rewrite of that page into a server component in this pass.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  return NextResponse.json({ identity: await loadIdentity(user.id) })
}

const Body = z.object({
  action: z.enum(['save-number', 'submit', 'reopen']),
  cnicNumber: z.string().max(40).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { action, cnicNumber } = parsed.data

  // ------------------------------------------------------- save-number ----
  if (action === 'save-number') {
    if (!isValidCnic(cnicNumber)) {
      return NextResponse.json(
        { error: CNIC_FORMAT_HINT, fields: { cnicNumber: CNIC_FORMAT_HINT } },
        { status: 400 },
      )
    }
    // Stored in the display form, which is how every Pakistani document and
    // every member writes it. normaliseCnic() is what makes the comparison
    // work regardless of how it arrived.
    const { error } = await supabase
      .from('profiles')
      .update({ cnic_number: formatCnic(cnicNumber) })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await recomputeCompletion(user.id)
    return NextResponse.json({ success: true, cnicNumber: formatCnic(cnicNumber) })
  }

  // ------------------------------------------------------------ reopen ----
  //
  // "Request a change" on an already-verified card. It clears the approval and
  // puts the member back in the queue, because a new photograph of a new card
  // has not been checked by anybody — leaving cnic_verified_at set while the
  // images underneath it change would mean the badge is vouching for a
  // document no human has seen.
  if (action === 'reopen') {
    const { error } = await supabase
      .from('profiles')
      .update({
        cnic_verified_at: null,
        verification_state: 'none',
        verification_rejection_reason: null,
      })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await recomputeCompletion(user.id)
    await logActivity({
      userId: user.id,
      event: 'verification_submitted',
      targetType: 'profile',
      targetId: user.id,
      meta: { reopened: true },
    })
    return NextResponse.json({ success: true, state: 'none' })
  }

  // ------------------------------------------------------------ submit ----
  const { data: profile } = await supabase
    .from('profiles')
    .select('cnic_number, cnic_image_path')
    .eq('id', user.id)
    .maybeSingle()

  if (!isValidCnic(profile?.cnic_number as string | null)) {
    return NextResponse.json({ error: 'Add your CNIC number first.' }, { status: 400 })
  }

  const { data: docs } = await supabase
    .from('user_documents')
    .select('id, label')
    .eq('user_id', user.id)
    .eq('kind', 'cnic')

  const hasFront = (docs ?? []).some((d) => (d.label as string | null) !== 'back')
  const hasBack = (docs ?? []).some((d) => (d.label as string | null) === 'back')
  if (!hasFront || !hasBack) {
    return NextResponse.json(
      { error: 'Upload a photo of both the front and the back of your card.' },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      verification_state: 'submitted',
      verification_submitted_at: new Date().toISOString(),
      verification_rejection_reason: null,
    })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recomputeCompletion(user.id)
  await logActivity({
    userId: user.id,
    event: 'verification_submitted',
    targetType: 'profile',
    targetId: user.id,
  })

  return NextResponse.json({ success: true, state: 'submitted' })
}
