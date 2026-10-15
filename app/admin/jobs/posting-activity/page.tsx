import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadTuitionPosting } from '@/lib/tuitionPosting'
import { change, changeLabel, type Change, type PostingRow } from '@/lib/tuitionPostingCore'
import { parsePeriod } from '@/lib/staffSignupsCore'

import SignupsTab from './SignupsTab'

// Tuitions → Tuition posting activity (owner, 15 Oct 2026). Every role that
// posts tuitions sees it (SCREEN_ACCESS.tuitionPosting): Tuitions staff,
// Operations, Admin and the Project Managers. Read only.
//
// Two tabs (owner, 15 Oct 2026): "Tuitions posted" (the board below) and
// "Sign-ups by staff" (SignupsTab — join links, credit, claims).

export const dynamic = 'force-dynamic'

export default async function TuitionPostingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tuitionPosting)
  const sp = await searchParams
  const tab = sp.tab === 'signups' ? 'signups' : 'posted'

  return (
    <div className="space-y-4">
      <nav aria-label="Tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
        <TabLink href="/admin/jobs/posting-activity" active={tab === 'posted'}>
          Tuitions posted
        </TabLink>
        <TabLink href="/admin/jobs/posting-activity?tab=signups" active={tab === 'signups'}>
          Sign-ups by staff
        </TabLink>
      </nav>
      {tab === 'signups' ? <SignupsTab actor={actor} period={parsePeriod(sp.period)} /> : <PostedTab />}
    </div>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
        active ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
      }`}
    >
      {children}
    </Link>
  )
}

async function PostedTab() {
  const { rows, total } = await loadTuitionPosting()

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Tuitions posted by each member of staff, in Pakistan time. &ldquo;Today vs Yesterday&rdquo; compares today so far
        with yesterday up to the same time of day.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">Yesterday</th>
              <th className="px-3 py-2 text-right">Last 7 days</th>
              <th className="px-3 py-2 text-right">Today vs Yesterday</th>
              <th className="px-3 py-2 text-right">Last 7 days vs previous 7</th>
              <th className="px-3 py-2 text-right">Repeated tuitions this week</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-gray-500">
                  No staff have posted tuitions in the last two weeks.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
            {rows.length > 0 && <Row row={total} strong />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ row, strong = false }: { row: PostingRow; strong?: boolean }) {
  const c = row.counts
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">{row.name}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.today}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.yesterday}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.last7}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <ChangeCell value={change(c.today, c.yesterdayToTime)} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <ChangeCell value={change(c.last7, c.prev7)} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.repeats > 0 ? (
          <Link href="/admin/jobs/duplicates" className="font-bold text-tm-red hover:underline">
            {row.repeats}
          </Link>
        ) : (
          <span className="text-gray-500">0</span>
        )}
      </td>
    </tr>
  )
}

function ChangeCell({ value }: { value: Change }) {
  const cls = !value || value.direction === 'same' ? 'text-gray-500' : value.direction === 'up' ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'
  return <span className={cls}>{changeLabel(value)}</span>
}
