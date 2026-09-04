import { Users } from 'lucide-react'
import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadBlockList, loadReportQueue } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import ReportQueue from './ReportQueue'

// The reports queue, and the read-only block list beside it.
//
// THE PRIVACY LINE lives in lib/adminQueues.ts with the query: message bodies
// are loaded only for reports whose target IS a thread, and only for the
// threads on the page being rendered. There is no input on this screen that
// could ask for any other conversation, and the member timeline never carries
// a body at all.

export const dynamic = 'force-dynamic'

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.reports)
  const { filter = 'open' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so reports cannot be loaded.
      </p>
    )
  }

  const [reports, blocks] = await Promise.all([loadReportQueue({ filter }), loadBlockList({})])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          A reported conversation can be read here. Nowhere else.
        </p>
        <Link
          href="/admin/users"
          className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
        >
          <Users aria-hidden size={14} />
          Members
        </Link>
      </header>

      <ReportQueue
        reports={reports.rows}
        blocks={blocks.rows}
        filter={filter}
        reportsCursor={reports.nextCursor}
        reportsTotal={reports.total}
        blocksCursor={blocks.nextCursor}
        blocksTotal={blocks.total}
      />
    </div>
  )
}
