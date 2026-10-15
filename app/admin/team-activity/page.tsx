import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadTuitionPosting } from '@/lib/tuitionPosting'
import { loadStaffActivity } from '@/lib/staffActivity'
import { change, changeLabel, type Change, type PostingRow } from '@/lib/tuitionPostingCore'
import { parsePeriod } from '@/lib/staffSignupsCore'
import {
  TEAM_TABS,
  pickTab,
  sortVerificationRows,
  tabsFor,
  teamActivityHref,
  verificationCounts,
  verificationTotal,
  type VerificationRow,
} from '@/lib/teamActivityCore'

import PaidTab from './PaidTab'

// Tuitions → Team activity (owner, 15 Oct 2026). ONE page in place of
// "Tuition posting activity" and "Staff activity", which showed overlapping
// numbers. Read only; counts only, never an amount.
//
//   Paid sign-ups (default)    every role on the page; Operations and Tuitions
//                              staff see their own row only.
//   Tuitions posted            everyone's rows, for every role on the page.
//   Verifications & messages   Owner, Project Managers and Admin only.
//
// Who sees which tab is lib/teamActivityCore (tabsFor / pickTab), the same rule
// the API (/api/admin/team-activity) refuses with 403. A tab the viewer may not
// open falls back to the default tab here.

export const dynamic = 'force-dynamic'

export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tuitionPosting)
  const sp = await searchParams
  const tabs = tabsFor(actor.adminRole)
  const tab = pickTab(actor.adminRole, sp.tab)

  return (
    <div className="space-y-4">
      <nav aria-label="Tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
        {TEAM_TABS.filter((t) => tabs.includes(t.key)).map((t) => (
          <TabLink key={t.key} href={teamActivityHref(t.key)} active={tab === t.key}>
            {t.label}
          </TabLink>
        ))}
      </nav>
      {tab === 'paid' && <PaidTab actor={actor} period={parsePeriod(sp.period)} />}
      {tab === 'posted' && <PostedTab />}
      {tab === 'verifications' && <VerificationsTab />}
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

// ---------------------------------------------------------- Tuitions posted

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
              <PostedRow key={r.id} row={r} />
            ))}
            {rows.length > 0 && <PostedRow row={total} strong />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PostedRow({ row, strong = false }: { row: PostingRow; strong?: boolean }) {
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

// ------------------------------------------- Verifications & messages

const METRICS = [
  { key: 'approved', label: 'Verifications approved' },
  { key: 'rejected', label: 'Verifications rejected' },
  { key: 'messages', label: 'Messages sent' },
] as const

async function VerificationsTab() {
  const staff = await loadStaffActivity()
  const rows: VerificationRow[] = sortVerificationRows(
    staff.map((s) => ({ id: s.id, name: s.name, counts: verificationCounts(s.counts) })),
  )
  const total = verificationTotal(rows)

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Verifications approved and rejected, and official TutorMint Team messages sent, by each member of staff. Today is
        Pakistan time. A name opens that person&rsquo;s full activity.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
            <tr>
              <th rowSpan={2} className="px-3 py-2 align-bottom">
                Staff
              </th>
              {METRICS.map((m) => (
                <th key={m.key} colSpan={3} className="border-l border-gray-200 px-3 pt-2 text-center">
                  {m.label}
                </th>
              ))}
            </tr>
            <tr>
              {METRICS.map((m) => (
                <WindowHeads key={m.key} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-gray-500">
                  No staff accounts yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <VerificationTableRow key={r.id} row={r} />
            ))}
            {rows.length > 0 && <VerificationTableRow row={total} strong />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WindowHeads() {
  return (
    <>
      <th className="border-l border-gray-200 px-3 pb-2 text-right">Today</th>
      <th className="px-3 pb-2 text-right">Last 7 days</th>
      <th className="px-3 pb-2 text-right">Total</th>
    </>
  )
}

function VerificationTableRow({ row, strong = false }: { row: VerificationRow; strong?: boolean }) {
  const linkable = row.id !== 'team'
  const cell = (metric: (typeof METRICS)[number]['key'], period: 'today' | 'week' | 'all', value: number, first: boolean) => (
    <td className={`px-3 py-2 text-right tabular-nums ${first ? 'border-l border-gray-100' : ''}`}>
      {linkable && value > 0 ? (
        <Link
          href={`/admin/team-activity/${row.id}?action=${metric}&period=${period}`}
          className="font-bold text-tm-navy hover:text-tm-red hover:underline"
        >
          {value}
        </Link>
      ) : (
        <span className={value > 0 ? '' : 'text-gray-500'}>{value}</span>
      )}
    </td>
  )
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">
        {linkable ? (
          <Link href={`/admin/team-activity/${row.id}`} className="text-tm-navy hover:text-tm-red hover:underline">
            {row.name}
          </Link>
        ) : (
          row.name
        )}
      </td>
      {METRICS.map((m) => (
        <MetricCells key={m.key}>
          {cell(m.key, 'today', row.counts[m.key].today, true)}
          {cell(m.key, 'week', row.counts[m.key].week, false)}
          {cell(m.key, 'all', row.counts[m.key].total, false)}
        </MetricCells>
      ))}
    </tr>
  )
}

function MetricCells({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
