import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, badgesForPlan } from '@/lib/entitlements'
import { pairMayShareContact } from '@/lib/messaging'
import { renderMessageBody } from '@/lib/masking'
import BadgeRow from '@/components/badges/BadgeRow'
import Thread from './Thread'

// One conversation.
//
// Masking is decided here, on the server, and the masked string is what
// reaches the browser: an unentitled reader is never sent the digits at all.
// Both participants must have contact rights before a number renders -- the
// rule is about the pair, not the reader -- so a Featured parent still sees a
// mask when the tutor on the other side is on the Verified plan.

export const dynamic = 'force-dynamic'

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/messages/${threadId}`)}`)

  const { data: thread } = await supabase
    .from('threads')
    .select('id, job_id, participant_a, participant_b, created_at')
    .eq('id', threadId)
    .maybeSingle()

  // RLS already limits this to the participants; a non-participant gets null
  // and therefore a 404, which is also what a made-up id gets. Nobody learns
  // whether a conversation they are not in exists.
  if (!thread) notFound()

  const otherId =
    thread.participant_a === user.id ? (thread.participant_b as string) : (thread.participant_a as string)

  const admin = createAdminClient()

  const [{ data: rows }, mayShare, ent] = await Promise.all([
    supabase
      .from('messages')
      .select('id, sender_id, body, created_at')
      .eq('thread_id', thread.id)
      .order('created_at'),
    pairMayShareContact(user.id, otherId),
    getEntitlements(user.id),
  ])

  let otherName = 'TutorMint member'
  let otherSlug: string | null = null
  let otherBadges: ReturnType<typeof badgesForPlan> = []

  if (admin) {
    const [{ data: profile }, { data: tutor }, { data: subs }] = await Promise.all([
      admin.from('profiles').select('full_name, role, profile_completion').eq('id', otherId).maybeSingle(),
      admin.from('tutor_profiles').select('slug').eq('id', otherId).maybeSingle(),
      admin
        .from('subscriptions')
        .select('plan_code')
        .eq('user_id', otherId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
    ])

    otherName = (profile?.full_name as string) ?? otherName
    otherSlug = (tutor?.slug as string) ?? null
    otherBadges = badgesForPlan(
      (subs ?? [])[0]?.plan_code as string | undefined,
      ((profile?.profile_completion as number) ?? 0) >= 100,
    )
  }

  let jobTitle: string | null = null
  let jobRef: string | null = null
  if (thread.job_id) {
    const { data: job } = await supabase
      .from('jobs')
      .select('title, job_tx_id')
      .eq('id', thread.job_id)
      .maybeSingle()
    jobTitle = (job?.title as string) ?? null
    jobRef = (job?.job_tx_id as string) ?? null
  }

  const messages = (rows ?? []).map((m) => {
    const rendered = renderMessageBody((m.body as string) ?? '', mayShare)
    return {
      id: m.id as string,
      senderId: m.sender_id as string,
      mine: m.sender_id === user.id,
      body: rendered.text,
      masked: rendered.masked,
      createdAt: m.created_at as string,
    }
  })

  const backHref = ent.audience === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages'

  return (
    <main className="flex min-h-screen flex-col bg-[#F8FAFC] text-[#334155]">
      <header className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href={backHref} className="text-[11px] font-bold text-[#d60008] hover:underline">
              ← Messages
            </Link>
            <h1 className="truncate text-sm font-black text-[#0F172A]">
              {otherSlug ? (
                <Link href={`/tutor/${otherSlug}`} className="hover:underline">
                  {otherName}
                </Link>
              ) : (
                otherName
              )}
            </h1>
            {jobTitle && (
              <p className="truncate text-[11px] text-gray-500">
                About:{' '}
                {jobRef ? (
                  <Link href={`/parent/dashboard/job/${jobRef}`} className="hover:underline">
                    {jobTitle}
                  </Link>
                ) : (
                  jobTitle
                )}
              </p>
            )}
          </div>
          {otherBadges.length > 0 && <BadgeRow badges={otherBadges} size="sm" />}
        </div>
      </header>

      <Thread
        threadId={thread.id as string}
        otherId={otherId}
        otherName={otherName}
        messages={messages}
        canShareContact={mayShare}
      />
    </main>
  )
}
