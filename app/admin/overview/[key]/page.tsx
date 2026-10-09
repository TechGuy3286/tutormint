import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { listHeader, loadOverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, isOverviewItemKey, parseFunnelDays } from '@/lib/overviewItemsCore'
import { pkr } from '@/lib/reconciliationCore'
import { loadMemberCards } from '@/lib/overviewCards'
import OverviewCardGrid, { type GridItem } from '@/components/admin/OverviewCardGrid'

// The list behind one Overview number (owner, 8 Oct 2026, item 5). It reads the
// SAME loader the Overview counted with (lib/overviewItems), so the header's
// count is the number of rows below and equals the number on the Overview.
// Guarded by the item's own SCREEN_ACCESS key — the key the Overview filters by.
// Rows render as a grid of cards (components/admin/OverviewCardGrid).

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
  // Member facts for the cards (owner, 9 Oct 2026) — added to the loader's own
  // rows, never adding or dropping one, so the cards equal the header count.
  const members = await loadMemberCards(list.rows.map((r) => r.memberId ?? '').filter(Boolean))
  const items: GridItem[] = list.rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail ?? null,
    href: r.href ?? null,
    amount: r.amount !== undefined ? pkr(r.amount) : null,
    badge: r.badge ?? null,
    actions: r.actions ?? [],
    memberId: r.memberId ?? null,
    reviewHref: r.reviewHref ?? null,
    member: (r.memberId && members.get(r.memberId)) || null,
  }))

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

      <OverviewCardGrid items={items} />
    </div>
  )
}
