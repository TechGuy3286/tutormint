import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { abandonTutorVideo } from '@/lib/videoCleanup'

// Delete a tutor's abandoned introduction placeholder (owner PR13 §2.2).
//
// The browser calls this when it gives up on an upload — a new file is picked,
// or the tab is closing — so the "processing" placeholder its resumable session
// left on the channel does not linger until the daily sweep. Best-effort: it
// only ever removes placeholders titled with THIS tutor's own id prefix that no
// tutor record points at, so it cannot touch a recorded video or anyone else's.

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'tutor') return NextResponse.json({ error: 'Not a tutor.' }, { status: 403 })

  const res = await abandonTutorVideo(user.id)
  return NextResponse.json({ ok: res.ok, deleted: res.deleted })
}
