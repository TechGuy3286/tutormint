import Link from 'next/link'
import { Download, Film, Trash2 } from 'lucide-react'

import { roleBadge, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { formatDate } from '@/lib/datetime'
import { loadMemberCards } from '@/lib/overviewCards'
import { loadProfileShares } from '@/lib/profileShare'
import { duplicateTags, inTab, loadDirectory, loadDirectoryDocs, type DirectoryPerson } from '@/lib/peopleDirectory'
import { openTags } from '@/lib/memberDuplicates'
import {
  DUP_WORDS,
  EXCLUDE_WORDS,
  PARENT_CHIPS,
  PARENT_VERIFICATION_WORDS,
  PEOPLE_TABS,
  paidTag,
  peopleHref,
  postedTag,
  type PeopleTab,
} from '@/lib/peopleDirectoryCore'
import OverviewCardGrid, { type FilterRow, type GridItem, type GridParent } from '@/components/admin/OverviewCardGrid'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'
import { gridView, pickChips, pickDocFilter } from '@/lib/cardGridPagingCore'

// People — Tutors | Parents | Staff (owner, 21 Oct 2026). The one member
// directory: it replaced Verification → Tutors, Verification → Parents,
// Overview → Tutors and Documents to approve. Every tab reads lib/peopleDirectory
// (one "who counts" rule), so its counts match the Overview cards and the
// sidebar badge. The cards are the shared admin card grid.
//
// Load more (owner, 28 Oct 2026): the search, every chip and every count are
// worked out HERE over the whole tab (lib/cardGridPagingCore); the browser gets
// 25 cards at a time (?n=), and only those 25 have their card facts loaded.

const TONE: Record<string, GridParent['verificationTone']> = { approved: 'good', waiting: 'pending', rejected: 'bad', none: 'neutral' }

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
  const d = await loadDirectory()
  const tutors = inTab(d.people, 'tutor', showAll)
  const parents = inTab(d.people, 'parent', showAll)
  const counts: Record<PeopleTab, number> = { tutors: tutors.length, parents: parents.length, staff: d.staff.length }
  const hiddenCount = d.people.filter((p) => p.excluded !== null && p.role === (tab === 'parents' ? 'parent' : 'tutor')).length
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
    const staffPage = pageSlice(d.staff, shownCount(sp.n))
    return (
      <div className="space-y-4">
        {header}
        <p className="text-xs text-gray-500">
          {d.staff.length} team {d.staff.length === 1 ? 'account' : 'accounts'}. A staff member&rsquo;s own tutor or parent account is listed on the Tutors or Parents tab.
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

  const list = tab === 'tutors' ? tutors : parents
  const viewPeople = d.people.filter((p) => showAll || p.excluded === null)
  const [docs, dupes] = await Promise.all([
    tab === 'tutors' ? loadDirectoryDocs() : Promise.resolve(null),
    // "Not a duplicate" hides a pair for good (owner, 26 Oct 2026).
    duplicateTags(viewPeople).then(openTags),
  ])

  const badgeFor = (p: DirectoryPerson) => (p.banned ? 'Banned' : p.suspended ? 'Paused' : p.excluded ? EXCLUDE_WORDS[p.excluded] : null)

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

  // The whole tab, searched, filtered and counted here — from facts already
  // loaded (name, city, badge, email + mobile, the chips' tags, Documents).
  const pool = list.map((p) => ({
    p,
    searchFields: [p.name, p.city, badgeFor(p)],
    searchText: p.searchText,
    tags: (tab === 'tutors'
      ? { paid: paidTag(p.feePaidAt) }
      : { posted: postedTag(p.parent?.tuitionsTotal ?? 0), pv: p.parent?.verification ?? 'none' }) as Record<string, string>,
    docs: docs?.get(p.id) ?? null,
  }))
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? ''
  const sel = pickChips(rows, sp)
  const docFilter = tab === 'tutors' ? pickDocFilter(sp.docs) : null
  const view = gridView(pool, { q, rows, sel, docFilter, shown: shownCount(sp.n) })

  // Card facts (photo, completion, share link) for the shown cards only.
  const ids = view.page.rows.map((x) => x.p.id)
  const [members, shares] = await Promise.all([
    loadMemberCards(ids),
    tab === 'tutors' ? loadProfileShares(ids) : Promise.resolve(null),
  ])

  const items: GridItem[] = view.page.rows.map(({ p, tags, docs: tutorDocs }) => {
    const parentWaiting = p.parent?.verification === 'waiting'
    return {
      id: p.id,
      title: p.name,
      detail: null,
      href: `/admin/users/${p.id}`,
      amount: null,
      badge: badgeFor(p),
      actions: [],
      memberId: p.id,
      reviewHref: tab === 'tutors' || parentWaiting ? `/admin/users/${p.id}#documents` : null,
      member: members.get(p.id) ?? null,
      docs: tutorDocs,
      share: shares?.get(p.id) ?? null,
      searchText: p.searchText,
      tags,
      parent: p.parent
        ? {
            mobileVerified: p.parent.mobileVerified,
            tuitionsOpen: p.parent.tuitionsOpen,
            tuitionsTotal: p.parent.tuitionsTotal,
            plan: p.parent.plan,
            verification: PARENT_VERIFICATION_WORDS[p.parent.verification],
            verificationTone: TONE[p.parent.verification],
            lastActive: p.parent.lastActive,
          }
        : null,
      dupes: (dupes.get(p.id) ?? []).map((l) => ({ id: l.id, name: l.name, reason: DUP_WORDS[l.reason], reasonKey: l.reason })),
    }
  })

  const videos = tab === 'tutors' ? list.filter((p) => p.videoWaiting).length : 0
  const parentsWaiting = tab === 'tutors' ? parents.filter((p) => p.parent?.verification === 'waiting').length : 0

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
