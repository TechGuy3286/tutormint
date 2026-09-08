import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadInboxThreads,
  loadConversation,
  loadTemplates,
  markMemberRepliesRead,
} from '@/lib/adminMessaging'
import InboxClient from './InboxClient'

// The official TutorMint Team ↔ member inbox. owner / manager / support.
//
// It reads admin_messages via the service role (like every admin queue), so a
// support admin sees every official conversation without being a participant.
// It NEVER reads member↔member threads — those live in a different table and are
// only ever surfaced on /admin/reports for a reported thread. That separation
// is the whole reason this is a dedicated store.

export const dynamic = 'force-dynamic'

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.inbox)
  const { to } = await searchParams

  const [threads, templates] = await Promise.all([loadInboxThreads(), loadTemplates()])

  // The selected member: the ?to param (a fresh compose from a member page) or
  // the first thread. A ?to member may have no messages yet.
  const selectedId = to ?? threads[0]?.memberId ?? null

  let conversation = selectedId ? await loadConversation(selectedId) : []
  let selectedName = threads.find((t) => t.memberId === selectedId)?.memberName ?? ''

  // Whether this member has a mobile on file — decides if the WhatsApp send is
  // offered. Fetched here (with the name) so the client never needs the number
  // itself; the server builds the wa.me link on send.
  let selectedHasMobile = false
  if (selectedId) {
    const admin = createAdminClient()
    const { data } = admin
      ? await admin.from('profiles').select('full_name, phone_number, whatsapp').eq('id', selectedId).maybeSingle()
      : { data: null }
    if (!selectedName) selectedName = (data?.full_name as string) ?? 'this member'
    selectedHasMobile = !!((data?.phone_number as string)?.trim() || (data?.whatsapp as string)?.trim())
  }

  // Opening a thread marks the member's replies read (the admin has seen them).
  if (selectedId) await markMemberRepliesRead(selectedId)
  // Re-read the count after marking, so the badge is right on this render.
  if (selectedId) conversation = await loadConversation(selectedId)

  return (
    <InboxClient
      threads={threads}
      templates={templates}
      selectedId={selectedId}
      selectedName={selectedName}
      selectedHasMobile={selectedHasMobile}
      conversation={conversation}
      canEditTemplates={roleSatisfies(actor.adminRole, ['manager'])}
    />
  )
}
