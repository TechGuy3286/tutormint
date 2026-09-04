import InboxShell from '@/components/messages/InboxShell'
import { getSessionUser } from '@/lib/auth'

// The tutor inbox with nothing selected. A tutor who cannot open a thread sees
// the reply-only notice above the panes; InboxShell decides that from their
// entitlements rather than from which page rendered it.

export const dynamic = 'force-dynamic'

export default async function TutorMessagesPage() {
  const session = await getSessionUser()
  return <InboxShell role="tutor" userId={session!.user.id} />
}
