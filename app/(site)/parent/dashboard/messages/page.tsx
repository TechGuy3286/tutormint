import InboxShell from '@/components/messages/InboxShell'
import { getSessionUser } from '@/lib/auth'

// The parent inbox with nothing selected.
//
// On a phone that is the whole page: the conversation list. On a laptop the
// right pane says which one to pick rather than sitting empty.

export const dynamic = 'force-dynamic'

export default async function ParentMessagesPage() {
  const session = await getSessionUser()
  return <InboxShell role="parent" userId={session!.user.id} />
}
