import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { listHeader, loadOverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, isOverviewItemKey, parseFunnelDays } from '@/lib/overviewItemsCore'
import { pkr } from '@/lib/reconciliationCore'

// The list behind one Overview number (owner, 8 Oct 2026, item 5). It reads the
// SAME loader the Overview counted with (lib/overviewItems), so the header's
// count is the number of rows below and equals the number on the Overview.
// Guarded by the item's own SCREEN_ACCESS key — the key the Overview filters by.

export const dynamic = 'force-dynamic'

export default async function OverviewListPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { key } = await params
  if (!isOverviewItemKey(key)) notFound()
  const meta = OVERVIEW_ITEMS[key]
  await requireAdminRole(...SCREEN_ACCESS[meta.screen])
  const sp = await searchParams
  const days = parseFunnelDays(sp.days)

  const list = await loadOverviewList(key, { days })

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">{meta.title}</h1>
          <p className="text-xs font-bold text-slate-700">
            {listHeader(list)}
            {list.amount !== undefined ? ` · ${pkr(list.amount)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={meta.funnel ? `/admin?funnel=${days}` : '/admin'}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
          >
            Back to Overview
          </Link>
          {list.workHref && (
            <Link
              href={list.workHref}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
            >
              Open the working screen
              <ArrowRight aria-hidden size={14} />
            </Link>
          )}
        </div>
      </header>

      {list.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">Nothing here right now.</p>
      ) : (
        <ol className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {list.rows.map((r, i) => {
            const body = (
              <span className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
                <span className="w-8 shrink-0 text-right text-[11px] font-bold text-gray-500">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-tm-navy">{r.title}</span>
                  {r.detail && <span className="block truncate text-[11px] text-gray-600">{r.detail}</span>}
                </span>
                {r.amount !== undefined && <span className="shrink-0 text-xs font-bold text-slate-700">{pkr(r.amount)}</span>}
              </span>
            )
            return (
              <li key={r.id}>
                {r.href ? (
                  <Link href={r.href} className="block hover:bg-tm-bg">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
