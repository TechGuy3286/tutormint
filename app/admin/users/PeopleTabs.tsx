import Link from 'next/link'
import { Download, Film, Trash2 } from 'lucide-react'

import { roleBadge, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { formatDate } from '@/lib/datetime'
import { loadMemberCards } from '@/lib/overviewCards'
import { loadProfileShares } from '@/lib/profileShare'
import { listPage, readSummary, summaryUpdatedLabel, type PeopleCardRow, type PeoplePayload } from '@/lib/adminSummary'
import { chipCountsFromList, peopleList, poolCount, sliceFromList, splitCounts } from '@/lib/adminSummaryCore'
import { DOC_FILTERS } from '@/lib/tutorDocSummaryCore'
import {
  PARENT_CHIPS,
  PEOPLE_TABS,
  peopleHref,
  type PeopleTab,
} from '@/lib/peopleDirectoryCore'
import OverviewCardGrid, { type FilterRow, type GridItem } from '@/components/admin/OverviewCardGrid'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'
import { pickChips, pickDocFilter } from '@/lib/cardGridPagingCore'

// People — Tutors | Parents | Staff (owner, 21 Oct 2026). The one member
// directory: it replaced Verification → Tutors, Verification → Parents,
// Overview → Tutors and Documents to approve. Every tab reads lib/peopleDirectory
// (one "who counts" rule), so its counts match the Overview cards and the
// sidebar badge. The cards are the shared admin card grid.
//
// Load more (owner, 28 Oct 2026): the search, every chip and every count are
// worked out HERE over the whole tab (lib/cardGridPagingCore); the browser gets
// 25 cards at a time (?n=), and only those 25 have their card facts loaded.


export default async function PeopleTabs({
  tab,
  showAll,
  role,
  sp = {},
}: {
  tab: PeopleTab
  showAll: boolean
  role: AdminRole
  /** The address: ?q, the chips (?paid, ?posted, ?pv, ?docs) and ?n. */
  sp?: Record<string, string | string[] | undefined>
}) {
  // Pre-calculated (owner, 1 Nov 2026 — lib/adminSummary): the tab counts and
  // staff list are one stored row; each tab's search, chips, counts and 25 rows
  // come from admin_list_page in SQL.
  const summary = await readSummary(['people', 'state'])
  const d = (summary.get('people')?.payload ?? null) as PeoplePayload | null
  const builtAt = ((summary.get('state')?.payload ?? {}) as { builtAt?: string | null }).builtAt ?? null
  const staffList = d?.staff ?? []
  const counts: Record<PeopleTab, number> = {
    tutors: (d?.counts.tutors ?? 0) + (showAll ? (d?.hidden.tutor ?? 0) : 0),
    parents: (d?.counts.parents ?? 0) + (showAll ? (d?.hidden.parent ?? 0) : 0),
    staff: staffList.length,
  }
  const hiddenCount = (tab === 'parents' ? d?.hidden.parent : d?.hidden.tutor) ?? 0
  const isOwner = role === 'owner'

  const tabHref = (t: PeopleTab) => peopleHref(t, { all: showAll && t !== 'staff' ? '1' : null })

  const header = (
    <div className="space-y-3">
      <nav aria-label="People tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
        {PEOPLE_TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
              tab === t.key ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
            }`}
          >
            {t.label} <span className="text-gray-500">({counts[t.key]})</span>
          </Link>
        ))}
      </nav>
      <p className="text-[11px] text-gray-500">{summaryUpdatedLabel(builtAt)}. Counts and lists are worked out every minute something changes.</p>
      <div className="flex flex-wrap items-center gap-2">
        {tab !== 'staff' && (
          <Link
            href={peopleHref(tab, { all: showAll ? null : '1' })}
            className="inline-flex min-h-[40px] items-center rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
          >
            {showAll ? 'Hide staff & test accounts' : `Show staff & test accounts (${hiddenCount})`}
          </Link>
        )}
        {roleSatisfies(role, SCREEN_ACCESS.memberMerge) && (
          <Link
            href="/admin/users/duplicates"
            className="inline-flex min-h-[40px] items-center rounded-full border border-tm-red/30 bg-white px-4 text-xs font-bold text-tm-red hover:border-tm-red"
          >
            Possible duplicates
          </Link>
        )}
        {roleMayWrite(role, SCREEN_ACCESS.cleanup) && (
          <Link
            href="/admin/users?filter=suspicious"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-tm-gold/30 bg-tm-tint-gold px-4 text-xs font-bold text-tm-gold-ink"
          >
            <Trash2 aria-hidden size={14} />
            Junk accounts
          </Link>
        )}
        {roleSatisfies(role, SCREEN_ACCESS.usersExport) && (
          <a
            href={`/api/admin/users/export?role=${tab === 'tutors' ? 'tutor' : tab === 'parents' ? 'parent' : 'admin'}`}
            className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            <Download aria-hidden size={14} />
            Export CSV
          </a>
        )}
      </div>
    </div>
  )

  if (tab === 'staff') {
    const seesActivity = roleSatisfies(role, SCREEN_ACCESS.staffActivity)
    const staffPage = pageSlice(staffList, shownCount(sp.n))
    return (
      <div className="space-y-4">
        {header}
        <p className="text-xs text-gray-500">
          {staffList.length} team {staffList.length === 1 ? 'account' : 'accounts'}. A staff member&rsquo;s own tutor or parent account is listed on the Tutors or Parents tab.
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {staffPage.rows.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4">
              <p className="truncate text-sm font-black text-tm-navy">{s.name}</p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                <dt className="text-gray-500">Role</dt>
                <dd className="text-right font-semibold text-slate-700">{roleBadge(s.adminRole, role)}</dd>
                <dt className="text-gray-500">Last active</dt>
                <dd className="text-right font-semibold text-slate-700">{s.lastActive ? formatDate(s.lastActive) : '—'}</dd>
              </dl>
              {s.suspended && <span className="self-start rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-bold text-tm-red">Paused</span>}
              <div className="mt-auto flex flex-wrap gap-2">
                {seesActivity && (
                  <Link
                    href={`/admin/team-activity/${s.id}`}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-navy px-2 text-[11px] font-bold text-white hover:bg-tm-navy-hover"
                  >
                    Team activity
                  </Link>
                )}
                <Link
                  href={`/admin/users/${s.id}`}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-2 text-[11px] font-bold text-slate-700 hover:border-tm-navy"
                >
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <LoadMoreLink shown={staffPage.shown} total={staffPage.total} noun="team accounts" />
      </div>
    )
  }

  const rows: FilterRow[] =
    tab === 'tutors'
      ? [
          {
            param: 'paid',
            label: 'Verification Fee',
            options: [
              { key: 'all', label: 'All' },
              { key: 'paid', label: 'Paid' },
              { key: 'unpaid', label: 'Unpaid' },
            ],
          },
        ]
      : [
          {
            param: 'posted',
            label: 'Tuitions',
            options: [
              { key: 'all', label: 'All' },
              { key: 'posted', label: 'Posted a tuition' },
              { key: 'notposted', label: 'Not posted yet' },
            ],
          },
          {
            param: 'pv',
            label: 'Verification',
            options: [{ key: 'all', label: 'All' }, ...PARENT_CHIPS.map((c) => ({ key: c.key, label: c.label, hideWhenZero: c.key === 'rejected' }))],
          },
        ]

  // The tab, searched, filtered, counted and paged in SQL (admin_list_page),
  // in the order lib/cardGridPagingCore always used.
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? ''
  const sel = pickChips(rows, sp)
  const docFilter = tab === 'tutors' ? pickDocFilter(sp.docs) : null
  const shown = shownCount(sp.n)
  const res = await listPage<PeopleCardRow>(peopleList(tab === 'tutors' ? 'tutor' : 'parent'), {
    fixed: showAll ? {} : { excluded: false },
    q,
    rows: rows.map((r) => ({ param: r.param, value: sel[r.param] ?? 'all' })),
    split: tab === 'tutors' ? 'docs' : null,
    splitValues: docFilter && docFilter !== 'all' ? [docFilter] : null,
    order: docFilter === 'waiting' ? 'sort_asc' : 'pos',
    limit: shown,
  })
  const pool = poolCount(res, rows, sel)
  const view = {
    allCount: res.all,
    searchedCount: res.searched,
    rowCounts: chipCountsFromList(res.rowCounts, rows),
    docCounts: docFilter ? splitCounts(res.split, DOC_FILTERS, pool) : null,
    page: sliceFromList(res.rows, res.total, shown),
  }

  // Card facts (photo, completion, share link) for the shown cards only.
  const ids = view.page.rows.map((x) => x.id)
  const [members, shares] = await Promise.all([
    loadMemberCards(ids),
    tab === 'tutors' ? loadProfileShares(ids) : Promise.resolve(null),
  ])

  const items: GridItem[] = view.page.rows.map(({ id, row: p }) => ({
    id,
    title: p.name,
    detail: null,
    href: `/admin/users/${id}`,
    amount: null,
    badge: p.badge,
    actions: [],
    memberId: id,
    reviewHref: tab === 'tutors' || p.parentWaiting ? `/admin/users/${id}#documents` : null,
    member: members.get(id) ?? null,
    docs: p.docs,
    share: shares?.get(id) ?? null,
    searchText: p.searchText,
    tags: p.tags,
    parent: p.parent,
    dupes: showAll ? p.dupesAll : p.dupes,
  }))

  const videos = tab === 'tutors' ? (d?.videosWaiting ?? 0) : 0
  const parentsWaiting = tab === 'tutors' ? (d?.parentsWaiting ?? 0) : 0

  return (
    <div className="space-y-4">
      {header}
      {(videos > 0 || parentsWaiting > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {videos > 0 && (
            <Link
              href="/admin/tutors/videos?filter=pending"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-tm-gold/30 bg-tm-tint-gold px-4 font-bold text-tm-gold-ink"
            >
              <Film aria-hidden size={14} />
              Intro videos waiting for review ({videos})
            </Link>
          )}
          {parentsWaiting > 0 && (
            <Link
              href={peopleHref('parents', { pv: 'waiting' })}
              className="inline-flex min-h-[40px] items-center rounded-xl border border-tm-gold/30 bg-tm-tint-gold px-4 font-bold text-tm-gold-ink"
            >
              Parents waiting for review ({parentsWaiting})
            </Link>
          )}
        </div>
      )}
      {tab === 'tutors' && (
        <p className="text-[11px] text-gray-500">
          Intro videos are reviewed on{' '}
          <Link href="/admin/tutors/videos" className="font-bold text-tm-navy underline-offset-2 hover:underline">
            Video reviews
          </Link>
          .
        </p>
      )}
      <OverviewCardGrid
        key={`${tab}:${showAll ? 'all' : 'real'}`}
        items={items}
        docFilters={tab === 'tutors'}
        isOwner={isOwner}
        filterRows={rows}
        paged={{
          basePath: '/admin/users',
          keep: { tab, all: showAll ? '1' : undefined },
          q,
          sel,
          rowCounts: view.rowCounts,
          docFilter,
          docCounts: view.docCounts,
          shown: view.page.shown,
          total: view.page.total,
          searchedCount: view.searchedCount,
          allCount: view.allCount,
          noun: tab === 'tutors' ? 'tutors' : 'parents',
        }}
      />
    </div>
  )
}
