import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'

import { logActivity } from '@/lib/activityLog'
import { formatCnic, isValidCnic, CNIC_FORMAT_HINT } from '@/lib/cnic'
import { recomputeCompletion } from '@/lib/completion'
import { loadIdentity } from '@/lib/identity'
import { recordTutorSelfChanges, maskCnicHistory } from '@/lib/fieldHistory'
import { alertIfReupload } from '@/lib/docReupload'
import { sendDuplicateCnicAlert } from '@/lib/payments/paymentAlerts'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })
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
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { action, cnicNumber } = parsed.data

  // An identity document is replaced, never removed (Replace is the only action
  // on the card), so there is no remove-image branch here — the previous one is
  // gone with the button. The private identity-docs objects are retained; a
  // replacement overwrites its side through /api/documents/upload.

  // ------------------------------------------------------- save-number ----
  if (action === 'save-number') {
    if (!isValidCnic(cnicNumber)) {
      return NextResponse.json(
        { error: CNIC_FORMAT_HINT, fields: { cnicNumber: CNIC_FORMAT_HINT } },
        { status: 400 },
      )
    }
    // PR106-H4 §3.8: a CNIC already on ANOTHER account cannot be saved. The
    // guard is a SECURITY DEFINER function so it compares across accounts without
    // reading anyone's number (returns only a boolean). An attempt raises a staff
    // alert for review; nothing about the other account is disclosed to the member.
    const digits = String(cnicNumber ?? '').replace(/\D/g, '')
    const guard = createAdminClient()
    if (guard) {
      const { data: inUse } = await guard.rpc('cnic_in_use', { p_digits: digits, p_except: user.id })
      if (inUse === true) {
        await sendDuplicateCnicAlert({ memberId: user.id }).catch(() => {})
        return NextResponse.json(
          { error: 'This CNIC is already registered on TutorMint. Message us on WhatsApp 0321 5872222 if this is a mistake.', fields: { cnicNumber: 'Already registered.' } },
          { status: 409 },
        )
      }
    }

    // The old value, for the change history (best-effort; never blocks the save).
    const { data: before } = await supabase.from('profiles').select('cnic_number').eq('id', user.id).maybeSingle()
    // Stored in the display form, which is how every Pakistani document and
    // every member writes it. normaliseCnic() is what makes the comparison
    // work regardless of how it arrived.
    const { error } = await supabase
      .from('profiles')
      .update({ cnic_number: formatCnic(cnicNumber) })
      .eq('id', user.id)
    if (error) return serverError(error, 'identity')

    // PR83 (Part C): a tutor's own change is recorded too (masked, no reason).
    await recordTutorSelfChanges(user.id, [
      { field: 'cnic_number', oldValue: maskCnicHistory(before?.cnic_number as string | null), newValue: maskCnicHistory(formatCnic(cnicNumber)) },
    ])
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
    // cnic_verified_at / verification_state are locked from the member client
    // (migration 103). Clearing them (a member asking to re-verify) goes through
    // the service role, scoped to their own id (PR48 §2).
    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222.\nیہ ابھی کام نہیں کر رہا۔ کچھ منٹ بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔' }, { status: 503 })
    const { error } = await admin
      .from('profiles')
      .update({
        cnic_verified_at: null,
        verification_state: 'none',
        verification_rejection_reason: null,
      })
      .eq('id', user.id)
    if (error) return serverError(error, 'identity')

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
    .eq('status', 'active') // PR106-H3 §1.4

  const hasFront = (docs ?? []).some((d) => (d.label as string | null) !== 'back')
  const hasBack = (docs ?? []).some((d) => (d.label as string | null) === 'back')
  if (!hasFront || !hasBack) {
    return NextResponse.json(
      { error: 'Upload a photo of both the front and the back of your card.' },
      { status: 400 },
    )
  }

  // verification_state is locked from the member client (migration 103) —
  // submitting for review goes through the service role, scoped to their own id,
  // after the CNIC-number and both-sides checks above (PR48 §2).
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222.\nیہ ابھی کام نہیں کر رہا۔ کچھ منٹ بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔' }, { status: 503 })
  // PR106-H4 §2.7: do NOT clear verification_rejection_reason here. After a
  // rejection the reason must LINGER so the Verified badge stays paused and
  // activity blocked through the re-upload — only a staff approval
  // (reviewTutorDocument) clears it and restores the badge. A first submission
  // has no reason, so leaving it is a no-op there.
  const { error } = await admin
    .from('profiles')
    .update({
      verification_state: 'submitted',
      verification_submitted_at: new Date().toISOString(),
    })
    .eq('id', user.id)
  if (error) return serverError(error, 'identity')

  // If this CNIC had been rejected, re-submitting re-queues it and alerts staff.
  await alertIfReupload(user.id, 'cnic')

  await recomputeCompletion(user.id)
  await logActivity({
    userId: user.id,
    event: 'verification_submitted',
    targetType: 'profile',
    targetId: user.id,
  })

  return NextResponse.json({ success: true, state: 'submitted' })
}
