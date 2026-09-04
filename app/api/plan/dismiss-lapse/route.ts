import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'

// "I know, and I am not renewing."
//
// The lapsed-plan row in NEEDS YOU stays until the member reactivates or says
// this. Dismissal is stored on the subscription rather than in a cookie, so it
// follows the member to their phone -- a notice that comes back on every
// device is the same notice they just dismissed.
//
// Scoped to the owner by user_id, so one member cannot clear another's row, and
// it only ever writes a timestamp: nothing about the subscription itself
// changes, and a member who dismisses and then buys again gets a fresh row with
// its own null.
//
// THE WRITE GOES THROUGH THE SERVICE ROLE, and the ownership check is the
// `.eq('user_id', ...)` below rather than RLS. `subscriptions` grants members
// SELECT only -- subscriptions_self_read -- so the member's own client silently
// updated ZERO rows and PostgREST returned success, which is how the first
// version of this shipped with a dismiss button that did nothing and said
// nothing. The alternative was granting members UPDATE on the table that
// records what they have paid for, restricted to one column by a column-level
// GRANT; that is a much wider door than this feature is worth.
//
// The row count is CHECKED. A write that matches nothing is reported as a
// failure here rather than answered with success, because "it worked" on a
// write that changed nothing is the exact defect this route already had once.

export const dynamic = 'force-dynamic'

const Body = z.object({ subscriptionId: z.guid() })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'That could not be saved right now.' }, { status: 503 })
  }

  const { data, error } = await admin
    .from('subscriptions')
    .update({ lapse_dismissed_at: new Date().toISOString() })
    .eq('id', parsed.data.subscriptionId)
    .eq('user_id', user.id)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data || data.length === 0) {
    // Either the id is not a real subscription or it is not theirs. Both
    // answer identically: this route must not report whether a subscription
    // id exists.
    return NextResponse.json({ error: 'That notice could not be dismissed.' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
