import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'

// "Send me updates on WhatsApp" on the tutor's Edit Profile (PR-06, owner 18 Nov
// 2026). Default on (tutor_profiles.whatsapp_updates, migration 235). Off takes
// the tutor out of the staff WhatsApp updates queue; the in-app teasers still
// show. The tutor changes only their own row; every change is logged.
//
//   GET  → { on }
//   POST { on: boolean } → { on }

export const dynamic = 'force-dynamic'

async function signedInTutor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 }) }
  const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (p?.role !== 'tutor') return { error: NextResponse.json({ error: 'This setting is for tutors.' }, { status: 403 }) }
  return { userId: user.id }
}

export async function GET() {
  const who = await signedInTutor()
  if ('error' in who) return who.error
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  const { data } = await admin.from('tutor_profiles').select('whatsapp_updates').eq('id', who.userId).maybeSingle()
  return NextResponse.json({ on: data?.whatsapp_updates !== false }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const Body = z.object({ on: z.boolean() })

export async function POST(request: Request) {
  const who = await signedInTutor()
  if ('error' in who) return who.error
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })

  const { data: cur } = await admin.from('tutor_profiles').select('whatsapp_updates').eq('id', who.userId).maybeSingle()
  if (!cur) return NextResponse.json({ error: 'Your tutor profile was not found.' }, { status: 404 })
  const on = parsed.data.on
  if ((cur.whatsapp_updates !== false) === on) return NextResponse.json({ on })

  const { error } = await admin.from('tutor_profiles').update({ whatsapp_updates: on }).eq('id', who.userId)
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })
  await logActivity({ userId: who.userId, event: 'whatsapp_updates_changed', targetType: 'tutor_profile', targetId: who.userId, meta: { on } })
  return NextResponse.json({ on })
}
