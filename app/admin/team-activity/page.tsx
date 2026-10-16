import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadTuitionPosting } from '@/lib/tuitionPosting'
import { loadDailyReport } from '@/lib/dailyReport'
import { change, changeLabel, type Change, type PostingRow } from '@/lib/tuitionPostingCore'
import { parseMonth } from '@/lib/staffTargetsCore'
import { TEAM_TABS, isRemovedTab, pickTab, tabsFor, teamActivityHref } from '@/lib/teamActivityCore'

import PaidTab from './PaidTab'

// Tuitions → Team activity (owner, 15 Oct 2026). ONE page in place of
// "Tuition posting activity" and "Staff activity", which showed overlapping
// numbers. Read only; counts only, never an amount.
//
//   Paid sign-ups (default)    a month at a time against monthly targets
//                              (owner, 16 Oct 2026); what each role sees is
//                              cut on the server (lib/staffTargets).
//   Tuitions posted            everyone's rows, for every role on the page.
//
// The "Verifications & messages" tab was removed (owner, 15 Oct 2026): a link
// to it lands on Paid sign-ups. Approvals and messages stay in Audit.

export const dynamic = 'force-dynamic'

/** The request's clock, read once per render. */
const nowMs = () => Date.now()

export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; month?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tuitionPosting)
  const sp = await searchParams
  if (isRemovedTab(sp.tab)) redirect(teamActivityHref('paid'))
  const tabs = tabsFor(actor.adminRole)
  // A staff member's detail page (tuitions they posted): Owner, Project
  // Managers and Admin.
  const detailLinks = roleSatisfies(actor.adminRole, SCREEN_ACCESS.staffActivity)
  const tab = pickTab(actor.adminRole, sp.tab)
  // Today's report for WhatsApp (owner, 16 Oct 2026), built on the server from
  // the same data as the tabs (lib/dailyReport).
  const report = await loadDailyReport(actor)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a
          href={report.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-green-deep px-4 py-2 text-xs font-bold text-white hover:bg-tm-green-deep-hover"
        >
          Send today&rsquo;s report on WhatsApp
        </a>
      </div>
      <nav aria-label="Tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
        {TEAM_TABS.filter((t) => tabs.includes(t.key)).map((t) => (
          <TabLink key={t.key} href={teamActivityHref(t.key)} active={tab === t.key}>
            {t.label}
          </TabLink>
        ))}
      </nav>
      {tab === 'paid' && <PaidTab actor={actor} month={parseMonth(sp.month, nowMs())} />}
      {tab === 'posted' && <PostedTab detailLinks={detailLinks} />}
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

async function PostedTab({ detailLinks }: { detailLinks: boolean }) {
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
              <PostedRow key={r.id} row={r} detailLinks={detailLinks} />
            ))}
            {rows.length > 0 && <PostedRow row={total} strong />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PostedRow({ row, strong = false, detailLinks = false }: { row: PostingRow; strong?: boolean; detailLinks?: boolean }) {
  const c = row.counts
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">
        {detailLinks && !strong ? (
          <Link href={`/admin/team-activity/${row.id}`} className="text-tm-navy hover:text-tm-red hover:underline">
            {row.name}
          </Link>
        ) : (
          row.name
        )}
      </td>
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
