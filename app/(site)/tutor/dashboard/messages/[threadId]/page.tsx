import InboxShell from '@/components/messages/InboxShell'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function TutorThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  const session = await getSessionUser()
  return <InboxShell role="tutor" userId={session!.user.id} threadId={threadId} />
}
