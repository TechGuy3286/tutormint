import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { listHeader, loadOverviewList, stuckTabCounts } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, PAYER_PERIODS, isOverviewItemKey, paidListHref, parseFunnelDays, parsePayerPeriod } from '@/lib/overviewItemsCore'
import { pkr } from '@/lib/reconciliationCore'
import { loadMemberCards } from '@/lib/overviewCards'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
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
  searchParams: Promise<{ days?: string; period?: string }>
}) {
  const { key } = await params
  if (!isOverviewItemKey(key)) notFound()
  const meta = OVERVIEW_ITEMS[key]
  const actor = await requireAdminRole(...SCREEN_ACCESS[meta.screen])
  const sp = await searchParams
  const days = parseFunnelDays(sp.days)

  // "Paid today" has a period switch (owner, 15 Oct 2026; it replaced
  // Payments → Recent payers). Today is the card's own number.
  const period = key === 'paid-today' ? parsePayerPeriod(sp.period) : undefined
  const list = await loadOverviewList(key, { days, period })
  // Member facts for the cards (owner, 9 Oct 2026) — added to the loader's own
  // rows, never adding or dropping one, so the cards equal the header count.
  const members = await loadMemberCards(list.rows.map((r) => r.memberId ?? '').filter(Boolean))
  // One combined Documents status per tutor card (owner, 19 Oct 2026), loaded
  // for the whole page at once — the member page's own status rules.
  const tutorIds = Array.from(members.entries()).filter(([, m]) => m.role === 'tutor').map(([id]) => id)
  const docs = await loadTutorDocSummaries(tutorIds)
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
    followUp: r.followUp ?? null,
    docs: (r.memberId && docs.get(r.memberId)) || null,
  }))
  // Stuck in onboarding and Follow-up sent are two tabs of one list (owner,
  // 9 Oct 2026), each with its own count.
  const tabbed = key === 'todo-stuck' || key === 'todo-stuck-sent'
  const tabCounts = tabbed ? await stuckTabCounts() : null

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">{meta.title}</h1>
          <p className="text-xs font-bold text-slate-700">
            {listHeader(list)}
            {list.amount !== undefined ? ` · ${pkr(list.amount)}` : ''}
          </p>
          {list.note && (
            <p className="text-[11px] leading-relaxed text-gray-600">
              {list.note.before}
              <span className={list.note.stale ? 'font-bold text-tm-red' : 'font-bold text-slate-700'}>{list.note.date}</span>
              {list.note.after}{' '}
              <Link href={list.note.href} className="font-bold text-tm-navy underline-offset-2 hover:underline">
                {list.note.linkLabel}
              </Link>
            </p>
          )}
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

      {period && (
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {PAYER_PERIODS.map((p) => {
            const on = p.key === period
            return (
              <Link
                key={p.key}
                href={paidListHref(p.key)}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-[40px] items-center rounded-full border px-4 text-xs font-bold ${
                  on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                }`}
              >
                {p.label}
              </Link>
            )
          })}
        </nav>
      )}

      {tabCounts && (
        <nav aria-label="Tabs" className="flex flex-wrap gap-2">
          {([
            ['todo-stuck', 'Stuck in onboarding', tabCounts.stuck],
            ['todo-stuck-sent', 'Follow-up sent', tabCounts.sent],
          ] as const).map(([k, label, n]) => {
            const on = k === key
            return (
              <Link
                key={k}
                href={`/admin/overview/${k}`}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                  on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                }`}
              >
                {label} <span className={on ? 'text-white' : 'text-gray-500'}>{n}</span>
              </Link>
            )
          })}
        </nav>
      )}

      <OverviewCardGrid items={items} docFilters={key === 'tutors'} isOwner={actor.adminRole === 'owner'} />
    </div>
  )
}
