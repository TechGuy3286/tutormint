import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { listSuggestions, postsDueForRefresh } from '@/lib/contentQueue/feed'
import { searchConsoleStatus } from '@/lib/contentQueue/build'
import QueueClient from '@/components/admin/blog/QueueClient'

// /admin/blog/queue — the content queue (CLAUDE.md 9.4). Manager + support.
//
// The suggestions are rebuilt nightly by the cron; this screen reads the live
// 'suggested' rows and lets a human act on them. Nothing here publishes — the
// strongest action is opening a pre-filled draft in the editor.

export const dynamic = 'force-dynamic'

export default async function ContentQueuePage() {
  await requireAdminRole(...SCREEN_ACCESS.blogQueue)

  const [{ content, recruitment }, refresh] = await Promise.all([
    listSuggestions(),
    postsDueForRefresh(8),
  ])
  const gsc = searchConsoleStatus()

  return (
    <QueueClient
      content={content}
      recruitment={recruitment}
      refresh={refresh}
      gsc={gsc}
    />
  )
}
