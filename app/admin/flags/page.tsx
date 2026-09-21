import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadFlagQueue } from '@/lib/adminFlags'
import FlagQueue from '@/components/admin/FlagQueue'

// The flagged-content queue (PR40 §2), under Trust. Messages, profile text,
// tuitions and display names that contained a banned word are raised here for
// staff — the content still went live (flag, do not block), and the author
// auto-suspends on their third open flag.
export const dynamic = 'force-dynamic'

export default async function FlagsPage() {
  await requireAdminRole(...SCREEN_ACCESS.reports)
  const rows = await loadFlagQueue()

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Content that matched the abuse filter. It still went live; the recipient was not told. Clear a
        flag once reviewed, or suspend the author. After three open flags an author is suspended
        automatically — reinstate here if they appeal.
      </p>
      <FlagQueue initial={rows} />
    </div>
  )
}
