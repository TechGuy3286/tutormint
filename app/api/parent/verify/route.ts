import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeCompletion } from '@/lib/completion'
import { calculateParentCompletion } from '@/lib/profileChecklist'
import { logActivity } from '@/lib/activityLog'

// Submit parent CNIC + address for admin verification.
//
// Sets verification_state = 'submitted' so the T3.5 admin queue can find it.
// It deliberately does NOT set cnic_verified_at / address_verified_at -- those
// are the admin's to set on approval, and they are what actually unlocks job
// posting. A parent cannot verify themselves by calling this route.

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, city, address, cnic_number, cnic_image_path, phone_verified_at, verification_state, cnic_verified_at, address_verified_at')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  if (profile.role !== 'parent' && profile.role !== 'academy') {
    return NextResponse.json({ error: 'Only parent accounts need this verification.' }, { status: 403 })
  }

  // The email item (PR29 §4) is a separate completion concern added in Settings
  // and confirmed by a link — it is NOT part of CNIC/address verification, and a
  // mobile-signup parent has no real email yet. Gating verification on it would
  // lock them out of posting jobs, so it is excluded from this gate.
  const completion = calculateParentCompletion({ profile })
  // CNIC + address are optional for posting (owner, 8 Oct 2026) but this IS the
  // CNIC/address submission, so every item — optional ones included — must be
  // filled before it goes to review.
  const missing = completion.items.filter((m) => !m.done && m.key !== 'email')
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'Complete every field before submitting.',
        missing: missing.map((m) => m.label),
      },
      { status: 400 },
    )
  }

  // verification_state is locked from the member's own client (migration 103) —
  // a parent must not be able to self-mark verified. Written through the service
  // role, scoped to their own id, after the completeness check above (PR48 §2).
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222.\nیہ ابھی کام نہیں کر رہا۔ کچھ منٹ بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔' }, { status: 503 })
  const { error } = await admin
    .from('profiles')
    .update({
      // An already-approved CNIC stays approved (owner, 8 Oct 2026): a parent
      // re-submitting to fix a rejected address must not lose it.
      ...(profile.cnic_verified_at
        ? {}
        : { verification_state: 'submitted', verification_rejection_reason: null }),
      verification_submitted_at: new Date().toISOString(),
      // The typed address waits for its own decision unless already approved.
      ...(profile.address_verified_at ? {} : { address_status: 'pending', address_reason: null }),
    })
    .eq('id', user.id)

  if (error) return serverError(error, 'parent/verify')

  await recomputeCompletion(user.id)
  await logActivity({
    userId: user.id, event: 'verification_submitted', targetType: 'profile', targetId: user.id,
  })

  return NextResponse.json({
    success: true,
    state: 'submitted',
    message: 'Submitted for verification. You cannot post a job until it is approved.',
  })
}
