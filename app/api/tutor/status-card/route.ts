import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/tutor/status-card (owner, 26 Oct 2026) — the tutor dismisses the
// one-time "You're verified! Share it on your status" card for good. Writes only
// the signed-in tutor's own tutor_profiles.status_card_dismissed_at.

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 })
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })
  const { error } = await admin
    .from('tutor_profiles')
    .update({ status_card_dismissed_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('status_card_dismissed_at', null)
  if (error) return NextResponse.json({ error: 'That did not save.' }, { status: 400 })
  return NextResponse.json({ success: true })
}
