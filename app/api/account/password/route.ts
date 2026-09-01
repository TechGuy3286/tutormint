import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'

// Replace a temporary password.
//
// Used by two kinds of account, which is why it lives here rather than inside
// either flow: staff invited from /admin/team when the project has no SMTP,
// and tutors created by the bulk import. Both arrive with a credential that
// somebody else generated and, in the import's case, sent over WhatsApp.
//
// must_change_password is cleared with the service role. If a member could
// clear it themselves the flag would be advisory, and the whole point is that
// the shared credential stops working after one use.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const password = body.password ?? ''

  // Deliberately a length rule and nothing else. Composition rules push people
  // towards Password1! and away from a long phrase; Supabase's own leaked
  // password protection is the check that actually helps, and it is turned on
  // in T8.
  if (password.length < 10) {
    return NextResponse.json(
      { error: 'Choose a password of at least 10 characters.' },
      { status: 400 },
    )
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    // "New password should be different from the old password" is the common
    // one and is worth passing through: it is actionable and reveals nothing.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const admin = createAdminClient()
  if (admin) {
    await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id)
  } else {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })
  }

  await logActivity({ userId: user.id, event: 'password_changed' })

  return NextResponse.json({ success: true })
}
