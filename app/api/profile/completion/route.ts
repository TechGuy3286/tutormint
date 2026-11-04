import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { flowFactsByTutor } from '@/lib/onboardingStop'
import { parentLineItems, parentRequiredItems, summariseRequired, tutorLineItems, tutorRequired } from '@/lib/profileRequired'

// GET /api/profile/completion — the signed-in member's completion from THE
// shared rule (lib/profileRequired): the percentage and each missing item with
// the Edit Profile card that fixes it. Edit Profile reads it for its top line
// and step counts and reads it again after every save (owner, 4 Nov 2026).
// Own data only; read-only.

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, city, phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })

  const headers = { 'Cache-Control': 'private, no-store' }
  if (profile.role === 'tutor') {
    const facts = (await flowFactsByTutor(createAdminClient() ?? supabase, [user.id])).get(user.id)
    if (!facts) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    const s = tutorRequired(facts)
    return NextResponse.json(
      { role: 'tutor', percent: s.percent, done: s.done, total: s.total, missing: tutorLineItems(s.missing), doneKeys: s.items.filter((i) => i.done).map((i) => i.key) },
      { headers },
    )
  }
  const s = summariseRequired(
    parentRequiredItems({ fullName: profile.full_name as string | null, city: profile.city as string | null, phoneVerified: !!profile.phone_verified_at }),
  )
  return NextResponse.json(
    { role: 'parent', percent: s.percent, done: s.done, total: s.total, missing: parentLineItems(s.missing), doneKeys: s.items.filter((i) => i.done).map((i) => i.key) },
    { headers },
  )
}
