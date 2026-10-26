import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadTuitionPosting } from '@/lib/tuitionPosting'
import { loadDailyReport } from '@/lib/dailyReport'
import { POSTED_COLUMNS, type PostingRow } from '@/lib/tuitionPostingCore'
import FormerStaffToggle from './FormerStaffToggle'
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
  const { rows, former, formerTotal, total } = await loadTuitionPosting()
  const empty = rows.length === 0 && former.length === 0

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">Tuitions posted by each member of staff, in Pakistan time. Highest Last 7 days first.</p>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
            <tr>
              {POSTED_COLUMNS.map((c, i) => (
                <th key={c} className={i === 0 ? 'px-3 py-2' : 'px-3 py-2 text-right'}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {empty && (
              <tr>
                <td colSpan={POSTED_COLUMNS.length} className="px-3 py-4 text-gray-500">
                  No staff have posted tuitions yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <PostedRow key={r.id} row={r} detailLinks={detailLinks} />
            ))}
            {formerTotal && <FormerStaffRows total={formerTotal} rows={former} detailLinks={detailLinks} />}
            {!empty && <PostedRow row={total} strong />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One collapsed "Former staff" row; the summary opens the people in it.
 *  A <details> cannot live inside <tbody>, so the rows are a client toggle. */
function FormerStaffRows({ total, rows, detailLinks }: { total: PostingRow; rows: PostingRow[]; detailLinks: boolean }) {
  return (
    <FormerStaffToggle
      summary={<PostedCells row={total} />}
      count={rows.length}
    >
      {rows.map((r) => (
        <PostedRow key={r.id} row={r} detailLinks={detailLinks} indent />
      ))}
    </FormerStaffToggle>
  )
}

function PostedCells({ row }: { row: PostingRow }) {
  const c = row.counts
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{c.today}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.yesterday}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.last7}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.allTime}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.repeats > 0 ? (
          <Link href="/admin/jobs/duplicates" className="font-bold text-tm-red hover:underline">
            {row.repeats}
          </Link>
        ) : (
          <span className="text-gray-500">0</span>
        )}
      </td>
    </>
  )
}

function PostedRow({ row, strong = false, detailLinks = false, indent = false }: { row: PostingRow; strong?: boolean; detailLinks?: boolean; indent?: boolean }) {
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className={indent ? 'py-2 pl-7 pr-3 font-bold' : 'px-3 py-2 font-bold'}>
        {detailLinks && !strong ? (
          <Link href={`/admin/team-activity/${row.id}`} className="text-tm-navy hover:text-tm-red hover:underline">
            {row.name}
            {indent && <span className="font-normal text-gray-500"> (former staff)</span>}
          </Link>
        ) : (
          <>
            {row.name}
            {indent && <span className="font-normal text-gray-500"> (former staff)</span>}
          </>
        )}
      </td>
      <PostedCells row={row} />
    </tr>
  )
}
