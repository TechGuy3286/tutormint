import InboxShell from '@/components/messages/InboxShell'
import { getSessionUser } from '@/lib/auth'

// One conversation, deep-linkable.
//
// This is the URL a notification, a job page or a shared link opens, and it
// renders the whole inbox with that conversation selected -- so arriving here
// from outside lands somewhere with context, not on a bare chat with no way to
// see the rest of the inbox.

export const dynamic = 'force-dynamic'

export default async function ParentThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  const session = await getSessionUser()
  return <InboxShell role="parent" userId={session!.user.id} threadId={threadId} />
}
