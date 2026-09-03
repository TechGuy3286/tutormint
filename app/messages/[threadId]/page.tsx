import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// /messages/[threadId] is the role-neutral conversation URL, and it stays.
//
// It is what `notify()` writes into every message notification's href, and
// what `markThreadRead` matches on, so it is the id of a conversation as far
// as the notifications table is concerned -- 49 rows already carry it. It is
// also the right shape for that job: at the moment a message is sent, the
// notification is being written for the OTHER person, and their role is not
// something the sender's code path should have to look up.
//
// The inbox itself is role-scoped, because the two panes belong inside the
// member's own dashboard. So this resolves the role once and forwards.
//
// The conversation view that used to live here (its own page, with its own
// copy of the masking and the composer) is gone: it was reachable only from a
// list that no longer exists, and two implementations of message rendering is
// two places for the masking rule to drift.

export const dynamic = 'force-dynamic'

export default async function ThreadRedirect({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/messages/${threadId}`)}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  redirect(
    profile?.role === 'tutor'
      ? `/tutor/dashboard/messages/${threadId}`
      : `/parent/dashboard/messages/${threadId}`,
  )
}
