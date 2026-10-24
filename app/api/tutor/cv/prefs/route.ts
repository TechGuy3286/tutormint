import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { isCvAccent } from '@/lib/cv/model'

// Saves the CV accent colour a tutor chose (owner, 24 Oct 2026). Signed-in
// tutors only, their own row only; the one column written is cv_accent
// (migration 199). A display preference — nothing else on the profile moves.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') return NextResponse.json({ error: 'Only tutors have a CV.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }
  const accent = (body as { accent?: unknown })?.accent
  if (!isCvAccent(accent)) {
    return NextResponse.json({ error: 'Choose Navy, Green or Charcoal.', fields: { accent: 'Choose Navy, Green or Charcoal.' } }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  }
  const { error } = await admin.from('tutor_profiles').update({ cv_accent: accent }).eq('id', user.id)
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })

  await logActivity({ userId: user.id, event: 'cv_accent_changed', meta: { accent } })
  return NextResponse.json({ ok: true, accent })
}
