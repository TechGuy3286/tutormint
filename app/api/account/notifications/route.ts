import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'

// Which emails a member wants.
//
// Written on the member's own client, so RLS scopes it: profiles_self_update
// admits `id = auth.uid()`, and the update names one column. There is no path
// here to set anyone else's preference and no path to touch a second column.

const Body = z.object({
  emailOptOut: z.boolean({ message: 'Tell us whether you want these emails.' }),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const { error } = await supabase
    .from('profiles')
    .update({ email_opt_out: parsed.data.emailOptOut })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logActivity({
    userId: user.id,
    event: 'email_preferences_changed',
    meta: { emailOptOut: parsed.data.emailOptOut },
  })

  return NextResponse.json({ success: true, emailOptOut: parsed.data.emailOptOut })
}
