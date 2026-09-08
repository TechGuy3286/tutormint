import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

// Official TutorMint Team messages live in the role inbox now (owner, Part 5):
// "two message screens is a place official messages go unread." This URL — the
// one every admin_message notification still carries — redirects into the Team
// pane of whichever inbox the member belongs to, the same treatment
// /messages/[threadId] already gets.

export const dynamic = 'force-dynamic'

export default async function AccountMessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/account/messages')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const base = profile?.role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages'
  redirect(`${base}/team`)
}
