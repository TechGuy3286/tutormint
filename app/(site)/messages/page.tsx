import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// /messages — the role-neutral inbox address (owner, 31 Oct 2026). The message
// digest email's "Open your messages" button points here, and it was a 404:
// only /messages/[threadId] existed. Resolves the role once and forwards, like
// that route; signed out → sign in, then back here.

export const dynamic = 'force-dynamic'

export default async function MessagesRedirect() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent('/messages')}`)

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role === 'admin') redirect('/admin/inbox')
  redirect(profile?.role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages')
}
