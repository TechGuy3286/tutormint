import { NextResponse } from 'next/server'

import { BAD_AVATAR_MESSAGE, isOurStorageUrl } from '@/lib/avatarUrl'
import { logActivity } from '@/lib/activityLog'
import { recomputeCompletion } from '@/lib/completion'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'

// A parent editing their own details.
//
// Parents had no settings screen at all, so there was no route for this: name,
// city and address were only ever writable from the verification flow, and a
// picture was not writable at all. A parent who mistyped their city at signup
// had no way to correct it.
//
// SCOPED TO THE SESSION, never to an id in the body — the pattern from
// api/parent/jobs. The write is `.eq('id', user.id)`, so the worst a crafted
// request can do is edit the sender's own row.
//
// PHONE IS NOT HERE, deliberately. Changing a number is not a field save: it
// re-opens the question of whether the number belongs to this person, and it
// changes the login identifier for a mobile-registered account. It goes
// through /api/auth/otp, which sends a code and only writes phone_number once
// the code comes back. A phone field on this route would let somebody set a
// number they do not hold.
//
// NOR IS cnic_number OR THE VERIFICATION STATE. Those belong to the
// verification flow and are an admin's to approve; a settings screen that
// could edit them would be a way to change an approved identity after the
// fact.

const Body = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  city: z.string().trim().max(80).optional().default(''),
  area: z.string().trim().max(80).optional().default(''),
  address: z.string().trim().max(500).optional().default(''),
  avatarUrl: z.string().trim().max(500).optional().default(''),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // The avatar has to be one of ours. An arbitrary URL here would let somebody
  // point their picture at a tracker that fires for every tutor who opens
  // their job — the picture is rendered on public job cards — and a data: URI
  // would put the image bytes themselves into every page that renders it. The
  // rule moved to lib/avatarUrl.ts when the tutor route needed the same one.
  if (body.avatarUrl && !isOurStorageUrl(body.avatarUrl)) {
    return NextResponse.json({ error: BAD_AVATAR_MESSAGE }, { status: 400 })
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: body.fullName,
      city: body.city || null,
      area: body.area || null,
      address: body.address || null,
      ...(body.avatarUrl ? { avatar_url: body.avatarUrl } : {}),
    })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recomputeCompletion(user.id)
  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: user.id,
    // No values in the meta: this timeline is admin-visible, and a home
    // address does not need to be in it twice.
    meta: { source: 'parent_settings' },
  })

  return NextResponse.json({ success: true })
}
