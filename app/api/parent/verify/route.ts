import { NextResponse } from 'next/server'
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
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, city, address, cnic_number, cnic_image_path, phone_verified_at, verification_state')
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
  const missing = completion.missing.filter((m) => m.key !== 'email')
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
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })
  const { error } = await admin
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
    userId: user.id, event: 'verification_submitted', targetType: 'profile', targetId: user.id,
  })

  return NextResponse.json({
    success: true,
    state: 'submitted',
    message: 'Submitted for verification. You cannot post a job until it is approved.',
  })
}
