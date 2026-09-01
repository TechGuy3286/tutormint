import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// /chat/[jobId] is the old, job-keyed chat URL. Conversations are keyed by
// THREAD now (a parent and a tutor can talk with no job attached at all), so
// this resolves the job to the caller's thread on it and redirects, keeping
// old links and bookmarks working.
//
// The page it replaced was a client component with a hardcoded array of
// invented tutors and no connection to the messages table.

export const dynamic = 'force-dynamic'

export default async function LegacyChatRedirect({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/chat/${jobId}`)}`)

  const isUuid = /^[0-9a-f-]{36}$/i.test(jobId)
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq(isUuid ? 'id' : 'job_tx_id', jobId)
    .maybeSingle()

  if (job) {
    const { data: thread } = await supabase
      .from('threads')
      .select('id')
      .eq('job_id', job.id)
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .maybeSingle()

    if (thread) redirect(`/messages/${thread.id}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  redirect(profile?.role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages')
}
