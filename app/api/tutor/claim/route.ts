import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'

// Claim an imported profile.
//
// An imported profile was typed in from a spreadsheet by an admin. Until the
// person it describes says "that is me", it is a claim TutorMint is making
// about someone, not one they have made about themselves — so it renders at
// its own URL and is excluded from browse, ranking and the sitemap
// (tutor_directory, migration 26).
//
// Three things have to be true before claimed_at is set, and this route
// re-checks all three rather than trusting the order of screens:
//
//   1. the temporary password has been replaced (must_change_password false)
//   2. the terms have been accepted, including the photo-use consent
//   3. the mobile number has been OTP-verified — the same number the import
//      created the account from, so this is what proves the account reached
//      the right person
//
// Claiming does NOT make anyone listable on its own. Completion still has to
// reach 100% and the ordinary verification rules still apply; import never
// buys a shortcut past them.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let body: { action?: string; acceptTerms?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { data: tutor } = await admin
    .from('tutor_profiles')
    .select('id, imported, claimed_at, terms_accepted_at')
    .eq('id', user.id)
    .maybeSingle()

  if (!tutor) return NextResponse.json({ error: 'No tutor profile on this account.' }, { status: 404 })
  if (!tutor.imported) {
    return NextResponse.json({ error: 'This profile was not imported.' }, { status: 400 })
  }
  if (tutor.claimed_at) return NextResponse.json({ success: true, alreadyClaimed: true })

  // ------------------------------------------------------------- terms ---
  if (body.action === 'accept-terms') {
    if (body.acceptTerms !== true) {
      return NextResponse.json({ error: 'You need to accept the terms to continue.' }, { status: 400 })
    }
    const { error } = await admin
      .from('tutor_profiles')
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logActivity({
      userId: user.id,
      event: 'terms_accepted',
      meta: { context: 'import_claim', photoConsent: true },
    })
    return NextResponse.json({ success: true, step: 'otp' })
  }

  // ------------------------------------------------------------ finish ---
  if (body.action === 'finish') {
    const { data: profile } = await admin
      .from('profiles')
      .select('must_change_password, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.must_change_password) {
      return NextResponse.json(
        { error: 'Set your own password first.', step: 'password' },
        { status: 409 },
      )
    }
    if (!tutor.terms_accepted_at) {
      return NextResponse.json({ error: 'Accept the terms first.', step: 'terms' }, { status: 409 })
    }
    if (!profile?.phone_verified_at) {
      return NextResponse.json(
        { error: 'Verify your mobile number first.', step: 'otp' },
        { status: 409 },
      )
    }

    const { error } = await admin
      .from('tutor_profiles')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('claimed_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logActivity({ userId: user.id, event: 'profile_claimed', targetType: 'tutor_profile', targetId: user.id })

    return NextResponse.json({ success: true, claimed: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
