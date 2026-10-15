import { Users } from 'lucide-react'
import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { loadBlockList, loadReportQueue } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import ReportQueue from './ReportQueue'
import { loadFlagQueue } from '@/lib/adminFlags'
import FlagQueue from '@/components/admin/FlagQueue'

// The reports queue, and the read-only block list beside it.
//
// THE PRIVACY LINE lives in lib/adminQueues.ts with the query: message bodies
// are loaded only for reports whose target IS a thread, and only for the
// threads on the page being rendered. There is no input on this screen that
// could ask for any other conversation, and the member timeline never carries
// a body at all.
//
// Trust → "Reports & flags" (owner, 15 Oct 2026): ONE page with two tabs —
// Reports | Flagged messages (?tab=flags) — each keeping its own queue and
// actions. Both are SCREEN_ACCESS.reports, as before. /admin/flags redirects
// to the Flagged messages tab.

export const dynamic = 'force-dynamic'

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; tab?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.reports)
  const sp = await searchParams
  const tab = sp.tab === 'flags' ? 'flags' : 'reports'
  if (tab === 'flags') {
    const rows = await loadFlagQueue()
    return (
      <div className="space-y-4">
        <ReportsTabs active="flags" />
        <p className="text-xs text-gray-500">
          Content that matched the abuse filter. It still went live; the recipient was not told. Clear a
          flag once reviewed, or suspend the author. After three open flags an author is suspended
          automatically — reinstate here if they appeal.
        </p>
        <FlagQueue initial={rows} />
      </div>
    )
  }
  // Ban from the queue is owner/manager only (the route enforces it too); a
  // support admin working the queue never sees the button.
  const canBan = roleMayWrite(actor.adminRole, ['admin', 'partner'])
  const { filter = 'open' } = sp

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
      <ReportsTabs active="reports" />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          A reported conversation can be read here. Nowhere else.
        </p>
        <Link
          href="/admin/users"
          className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
        >
          <Users aria-hidden size={14} />
          People
        </Link>
      </header>

      <ReportQueue
        reports={reports.rows}
        blocks={blocks.rows}
        filter={filter}
        canBan={canBan}
        reportsCursor={reports.nextCursor}
        reportsTotal={reports.total}
        blocksCursor={blocks.nextCursor}
        blocksTotal={blocks.total}
      />
    </div>
  )
}

function ReportsTabs({ active }: { active: 'reports' | 'flags' }) {
  const tabs = [
    { key: 'reports', label: 'Reports', href: '/admin/reports' },
    { key: 'flags', label: 'Flagged messages', href: '/admin/reports?tab=flags' },
  ] as const
  return (
    <nav aria-label="Tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? 'page' : undefined}
          className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
            active === t.key ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
