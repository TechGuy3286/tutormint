import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { pauseMyAccount } from '@/lib/selfPause'

// "Pause my account" (owner, 8 Oct 2026). A signed-in tutor or parent hides
// their own account; signing in again brings it back (lib/selfPause.ts).
//
//   GET   { paidPlan } — whether the confirmation must say the plan days keep
//         running (a tutor on Premium or Featured).
//   POST  pauses, revokes every session, and signs this browser out.
//
// Scoped to the caller (auth.getUser), never to an id in the request.

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })
  const ent = await getEntitlements(user.id)
  return NextResponse.json({ paidPlan: ent.plan === 'premium' || ent.plan === 'featured' })
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const result = await pauseMyAccount(user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Every other device was signed out by revoke_user_sessions; this clears the
  // cookies on this one.
  await supabase.auth.signOut({ scope: 'local' })
  return NextResponse.json({ ok: true, tuitionsPaused: result.tuitionsPaused })
}
