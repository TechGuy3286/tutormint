import { peopleExportHref, peopleListQuery } from '@/lib/peopleListQuery'
import { ERASE_CHIP_HINT, ERASE_CHIP_LABEL } from '@/lib/eraseRequestedCore'
import Link from 'next/link'
import { Download, Film, Trash2 } from 'lucide-react'

import { roleBadge, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { formatDate } from '@/lib/datetime'
import { loadMemberCards } from '@/lib/overviewCards'
import { loadProfileShares } from '@/lib/profileShare'
import { listPage, readSummary, summaryUpdatedLabel, type PeopleCardRow, type PeoplePayload } from '@/lib/adminSummary'
import { chipCountsFromList, peopleList, sliceFromList } from '@/lib/adminSummaryCore'
import {
  PEOPLE_TAB_SCREENS,
  PEOPLE_TABS,
  peopleFixed,
  peopleHref,
  type PeopleTab,
} from '@/lib/peopleDirectoryCore'
import { parseFuTab } from '@/lib/tutorFollowUpTabsCore'
import { parseParentChip } from '@/lib/parentFollowUpCore'
import { waChatHref, waSendHref } from '@/lib/waLinkCore'
import { CHIP_HINT } from '@/lib/tutorPipelineCore'
import { senderRefCode } from '@/lib/staffSignups'
import { loadBackendSupportKpi } from '@/lib/backendSupportKpi'
import BackendSupportKpiView from '@/components/admin/BackendSupportKpiView'
import { OrphansTab, ParentFollowUpsTab } from './FollowUpTabs'
import OverviewCardGrid, { type GridItem } from '@/components/admin/OverviewCardGrid'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { pageSlice, shownCount } from '@/lib/adminPagingCore'

// People — Tutors | Parents | Staff (owner, 21 Oct 2026). The one member
// directory: it replaced Verification → Tutors, Verification → Parents,
// Overview → Tutors and Documents to approve. Every tab reads lib/peopleDirectory
// (one "who counts" rule), so its counts match the Overview cards and the
// sidebar badge. The cards are the shared admin card grid.
//
// Load more (owner, 28 Oct 2026): the search, every chip and every count are
// worked out HERE over the whole tab (lib/cardGridPagingCore); the browser gets
// 25 cards at a time (?n=), and only those 25 have their card facts loaded.


// Follow-ups merged in (owner, 8 Nov 2026): the Tutors tab is ONE pipeline —
// stage chips (lib/tutorPipelineCore), and for Documents missing, Rejected and
// Approved fee pending a "Not followed up / Followed up" row. The old Paid /
// Unpaid row, the Documents chips and "Closest to paying" are gone. The
// "Parents & email not confirmed" and "Orphaned accounts" tabs moved here.

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function PeopleTabs({
  tab,
  showAll,
  showDeleted = false,
  role,
  actorId,
  sp = {},
}: {
  tab: PeopleTab
  showAll: boolean
  /** The grey "Deleted" chip (owner, 5 Nov 2026): erased accounts, for the record only. */
  showDeleted?: boolean
  role: AdminRole
  /** The viewer: their staff code goes on every WhatsApp link. */
  actorId?: string
  /** The address: ?q, the chips (?stage, ?fu, ?posted, ?pv), ?ni, ?signed and ?n. */
  sp?: Record<string, string | string[] | undefined>
}) {
  const mayTab = (t: PeopleTab) => PEOPLE_TAB_SCREENS[t].some((s) => roleSatisfies(role, SCREEN_ACCESS[s]))
  const directory = roleSatisfies(role, SCREEN_ACCESS.usersView)
  // Pre-calculated (owner, 1 Nov 2026 — lib/adminSummary): the tab counts and
  // staff list are one stored row; each tab's search, chips, counts and 25 rows
  // come from admin_list_page in SQL.
  const summary = await readSummary(['people', 'state'])
  const d = (summary.get('people')?.payload ?? null) as PeoplePayload | null
  const builtAt = ((summary.get('state')?.payload ?? {}) as { builtAt?: string | null }).builtAt ?? null
  const staffList = d?.staff ?? []
  const counts: Record<'tutors' | 'parents' | 'staff', number> = {
    tutors: (d?.counts.tutors ?? 0) + (showAll ? (d?.hidden.tutor ?? 0) : 0),
    parents: (d?.counts.parents ?? 0) + (showAll ? (d?.hidden.parent ?? 0) : 0),
    staff: staffList.length,
  }
  const hiddenCount = (tab === 'parents' ? d?.hidden.parent : d?.hidden.tutor) ?? 0
  const deletedCount = (tab === 'parents' ? d?.deleted?.parent : d?.deleted?.tutor) ?? 0
  // Erase requested (PR-04): a grey chip like Deleted; never followed up.
  const eraseCount = (tab === 'parents' ? d?.eraseRequested?.parent : d?.eraseRequested?.tutor) ?? 0
  const showErase = !showDeleted && (Array.isArray(sp?.erase) ? sp?.erase[0] : sp?.erase) === '1'
  const isOwner = role === 'owner'

  const tabHref = (t: PeopleTab) => peopleHref(t, { all: showAll && (t === 'tutors' || t === 'parents') ? '1' : null })
  const countOf = (t: PeopleTab): number | null => (t === 'tutors' || t === 'parents' || t === 'staff' ? counts[t] : null)
  const directoryTab = tab === 'tutors' || tab === 'parents' || tab === 'staff'

  // Export CSV carries the list on screen and says how many rows it holds.
  const headerFor = (exportCount: number | null) => (
    <div className="space-y-3">
      <nav aria-label="People tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
        {PEOPLE_TABS.filter((t) => mayTab(t.key)).map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
              tab === t.key ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
            }`}
          >
            {t.label} {countOf(t.key) !== null && <span className="text-gray-500">({countOf(t.key)})</span>}
          </Link>
        ))}
      </nav>
      <p className="text-[11px] text-gray-500">{summaryUpdatedLabel(builtAt)}. Counts and lists are worked out every minute something changes.</p>
      {directoryTab && directory && (
      <div className="flex flex-wrap items-center gap-2">
        {tab !== 'staff' && (
          <Link
            href={peopleHref(tab, { all: showAll ? null : '1' })}
            title={CHIP_HINT.staffTest}
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
            href={peopleExportHref(tab === 'tutors' ? 'tutors' : tab === 'parents' ? 'parents' : 'staff', sp)}
            className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            <Download aria-hidden size={14} />
            {exportCount === null ? 'Export CSV' : `Export CSV (${exportCount})`}
          </a>
        )}
        {tab !== 'staff' && (
          <Link
            href={showDeleted ? peopleHref(tab) : peopleHref(tab, { deleted: '1' })}
            aria-current={showDeleted ? 'page' : undefined}
            title={CHIP_HINT.deleted}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
              showDeleted ? 'border-gray-500 bg-gray-500 text-white' : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-500'
            }`}
          >
            Deleted <span className={showDeleted ? 'text-white' : 'text-gray-600'}>{deletedCount}</span>
          </Link>
        )}
        {tab !== 'staff' && (eraseCount > 0 || showErase) && (
          <Link
            href={showErase ? peopleHref(tab) : peopleHref(tab, { erase: '1' })}
            aria-current={showErase ? 'page' : undefined}
            title={ERASE_CHIP_HINT}
            data-erase-chip=""
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
              showErase ? 'border-gray-500 bg-gray-500 text-white' : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-500'
            }`}
          >
            {ERASE_CHIP_LABEL} <span className={showErase ? 'text-white' : 'text-gray-600'}>({eraseCount})</span>
          </Link>
        )}
      </div>
      )}
    </div>
  )

  const header = headerFor(tab === 'staff' ? staffList.length : null)

  if (tab === 'parent_followups') {
    return (
      <div className="space-y-4">
        {header}
        <ParentFollowUpsTab
          showNotInterested={one(sp.scope) === 'not_interested'}
          fuTab={parseFuTab(one(sp.fu))}
          chip={parseParentChip(one(sp.chip))}
          shown={shownCount(sp.n)}
          shownNoReply={shownCount(sp.nr)}
        />
      </div>
    )
  }
  if (tab === 'orphans') {
    return (
      <div className="space-y-4">
        {header}
        <OrphansTab />
      </div>
    )
  }

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

  // The list on screen — the same query Export CSV runs (lib/peopleListQuery).
  const lq = peopleListQuery(tab === 'tutors' ? 'tutors' : 'parents', sp, { showAll, showDeleted })
  const { isTutors, rows, sel, followRow, showNi, signed, view, q, stageSel } = lq
  const shown = shownCount(sp.n)
  const res = await listPage<PeopleCardRow>(lq.list, {
    fixed: lq.fixed,
    since: lq.since,
    until: lq.until,
    q,
    rows: lq.rowQuery,
    order: lq.order,
    limit: shown,
  })
  // The counts come back keyed by the stored tag; the chips read them by param.
  const rowCountsByParam = Object.fromEntries(rows.map((r) => [r.param, res.rowCounts[r.sqlParam ?? r.param] ?? {}]))
  const page = sliceFromList(res.rows, res.total, shown)

  // The Not interested chip's count, the viewer's staff code, and Backend Support's own numbers.
  const [niRes, kpi, refCode] = await Promise.all([
    isTutors && view === 'real' ? listPage(peopleList('tutor'), { fixed: { ...peopleFixed('real'), ni: true }, limit: 1 }) : Promise.resolve(null),
    isTutors && role === 'backend_support' && actorId ? loadBackendSupportKpi(actorId).catch(() => null) : Promise.resolve(null),
    actorId ? senderRefCode(actorId) : Promise.resolve(null),
  ])

  // Card facts (photo, completion, share link) for the shown cards only.
  const ids = page.rows.map((x) => x.id)
  const [members, shares] = await Promise.all([loadMemberCards(ids), isTutors ? loadProfileShares(ids) : Promise.resolve(null)])
  const mayFollow = roleSatisfies(role, SCREEN_ACCESS.unpaidSignups)

  const items: GridItem[] = page.rows.map(({ id, row: p }) => {
    const m = members.get(id) ?? null
    const msisdn = m?.msisdn ?? null
    const pipe = isTutors && p.pipe ? p.pipe : null
    return {
      id,
      title: p.name,
      detail: null,
      href: `/admin/users/${id}`,
      amount: null,
      badge: p.badge,
      actions: [],
      memberId: id,
      reviewHref: isTutors || p.parentWaiting ? `/admin/users/${id}#documents` : null,
      member: m,
      docs: p.docs,
      share: shares?.get(id) ?? null,
      searchText: p.searchText,
      tags: p.tags,
      parent: p.parent,
      dupes: directory ? (showAll ? p.dupesAll : p.dupes) : [],
      pipe:
        pipe && mayFollow
          ? {
              card: pipe,
              links: {
                waHref: msisdn && pipe.message ? waSendHref(msisdn, pipe.message, refCode) : null,
                chatHref: waChatHref(msisdn),
                telHref: msisdn ? `tel:+${msisdn}` : null,
              },
            }
          : null,
    }
  })

  const videos = isTutors && directory ? (d?.videosWaiting ?? 0) : 0
  const parentsWaiting = isTutors && directory ? (d?.parentsWaiting ?? 0) : 0
  const niCount = niRes?.all ?? 0
  const keep: Record<string, string | undefined> = {
    tab,
    all: showAll ? '1' : undefined,
    deleted: showDeleted ? '1' : undefined,
    erase: showErase ? '1' : undefined,
    ni: showNi ? '1' : undefined,
    signed: signed ?? undefined,
  }

  return (
    <div className="space-y-4">
      {headerFor(res.total)}
      {kpi && <BackendSupportKpiView kpi={kpi} />}
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
      {showErase && (
        <p className="text-[11px] text-gray-500">Members who asked for their account to be erased. Never followed up; the card shows the erase date. If the erase is cancelled they return to their stage.</p>
      )}
      {showDeleted && (
        <p className="text-[11px] text-gray-500">Accounts erased at the member&rsquo;s request, kept for the record. They are in no work list or count.</p>
      )}
      {isTutors && !showDeleted && !showErase && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <p className="min-w-0 flex-1">
            {signed ? 'Tutors who signed up on this day and have not paid. ' : ''}
            Each tutor is in one stage. Follow-ups: a WhatsApp message, then a voice note 2 days later, then WhatsApp or a call every 3 days, until they pay or are marked Not interested.
          </p>
          {view === 'real' && (
            <Link
              href={showNi ? peopleHref('tutors') : peopleHref('tutors', { ni: '1' })}
              aria-current={showNi ? 'page' : undefined}
              title={CHIP_HINT.ni}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                showNi ? 'border-gray-500 bg-gray-500 text-white' : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-500'
              }`}
            >
              Not interested <span className={showNi ? 'text-white' : 'text-gray-600'}>{niCount}</span>
            </Link>
          )}
        </div>
      )}
      <OverviewCardGrid
        key={`${tab}:${view}:${showNi ? 'ni' : ''}`}
        items={items}
        isOwner={isOwner}
        filterRows={rows}
        paged={{
          basePath: '/admin/users',
          keep,
          q,
          sel,
          rowCounts: chipCountsFromList(rowCountsByParam, rows),
          docFilter: null,
          docCounts: null,
          shown: page.shown,
          total: page.total,
          searchedCount: res.searched,
          allCount: res.all,
          noun: isTutors ? 'tutors' : 'parents',
          // A card moves out of these chips at once after a follow-up (owner, 15 Nov 2026).
          pipelineView:
            isTutors && !showDeleted && !showErase
              ? { stage: sel.stage ?? stageSel, fu: followRow ? (sel.fu ?? 'not') : null, ni: view === 'real' && !signed ? showNi : undefined }
              : undefined,
        }}
      />
    </div>
  )
}
