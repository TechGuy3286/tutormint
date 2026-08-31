import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { calculateParentCompletion } from '@/lib/profileChecklist'

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

  const completion = calculateParentCompletion({ profile })
  if (completion.percent < 100) {
    return NextResponse.json(
      {
        error: 'Complete every field before submitting.',
        missing: completion.missing.map((m) => m.label),
      },
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

  return NextResponse.json({
    success: true,
    state: 'submitted',
    message: 'Submitted for verification. You cannot post a job until it is approved.',
  })
}
