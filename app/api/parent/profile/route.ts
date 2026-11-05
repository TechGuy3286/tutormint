import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'

import { BAD_AVATAR_MESSAGE, isOurStorageUrl } from '@/lib/avatarUrl'
import { logActivity } from '@/lib/activityLog'
import { recomputeCompletion } from '@/lib/completion'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'
import { formatName } from '@/lib/formatName'
import { cnicNameLocked } from '@/lib/memberNamesCore'
import { displayNameRefusal } from '@/lib/memberNames'

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

// Two names (owner, 5 Nov 2026): fullName is the Name on CNIC (locked once the
// CNIC is approved), displayName the optional name tutors see. profiles.full_name
// follows in the database (migration 224).
const Body = z.object({
  fullName: z.string().trim().min(2, 'Enter your name as on your CNIC.').max(120),
  displayName: z.string().trim().max(60).optional(),
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
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

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

  if (body.displayName !== undefined) {
    const dp = await displayNameRefusal(user.id, body.displayName)
    if (dp) return NextResponse.json({ error: dp, fields: { displayName: dp } }, { status: 400 })
  }
  const { data: cur } = await supabase.from('profiles').select('cnic_name, cnic_verified_at, verification_state').eq('id', user.id).maybeSingle()
  const cnicName = formatName(body.fullName)
  const locked = !!cur && cnicNameLocked(cur)
  if (locked && cnicName !== formatName((cur?.cnic_name as string | null) ?? '')) {
    return NextResponse.json({ error: 'To change your Name on CNIC, please contact our support.' }, { status: 403 })
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      ...(locked ? {} : { cnic_name: cnicName }),
      ...(body.displayName !== undefined ? { display_name: formatName(body.displayName) || null } : {}),
      city: body.city || null,
      area: body.area || null,
      address: body.address || null,
      ...(body.avatarUrl ? { avatar_url: body.avatarUrl } : {}),
    })
    .eq('id', user.id)

  if (error) return serverError(error, 'parent/profile')

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
