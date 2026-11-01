import { senderRefCode } from '@/lib/staffSignups'
import { waHrefWithRef } from '@/lib/waLinkCore'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { ADMIN_PAGE_SIZE, shownCount } from '@/lib/adminPagingCore'
import Link from 'next/link'
import { permanentRedirect, redirect } from 'next/navigation'

import { requireAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadBackendSupportKpi } from '@/lib/backendSupportKpi'
import BackendSupportKpiView from '@/components/admin/BackendSupportKpiView'
import { canApprove } from '@/lib/adminAccessCore'
import { loadProfileShares } from '@/lib/profileShare'
import {
  isSignupWindow,
  parseTutorScope,
  TUTOR_SCOPE_LABEL,
  TUTOR_SCOPES,
  UNPAID_WINDOW_DAYS,
  type SignupWindow,
  type TutorScope,
} from '@/lib/staffOutreachCore'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import {
  FOLLOW_CHIP_LABEL,
  FOLLOW_CHIPS,
  legacyFollowUpsRedirect,
  parseFollowChip,
  type ChipFilter,
} from '@/lib/tutorFollowUpCore'
import {
  FOLLOW_UP_TABS,
  followUpTabsFor,
  followUpsHref,
  pickFollowUpTab,
} from '@/lib/followUpsPageCore'
import QueueSearch from '@/components/admin/QueueSearch'
import { FU_TAB_LABEL, parseFuTab, type FuTab } from '@/lib/tutorFollowUpTabsCore'

import { legacyApplicationsHref } from '@/lib/applicationStageCore'

import UnpaidSignupRow from './UnpaidSignupRow'
import ParentFollowUpsBoard, { type ParentCard } from './ParentFollowUpsBoard'
import { PARENT_CHIP_LABEL, parseParentChip, type ParentChip } from '@/lib/parentFollowUpCore'
import OrphansSection from './OrphansSection'
import { listPage, readSummary, summaryUpdatedLabel } from '@/lib/adminSummary'
import { PARENT_FU_LIST, sliceFromList, tutorFuList, windowRange } from '@/lib/adminSummaryCore'
import type { TutorFollowRow } from '@/lib/tutorFollowUps'
import type { ParentFollowRow as ParentRow } from '@/lib/parentFollowUps'

// People → Follow-ups (owner, 15 Oct 2026): ONE page in place of Unpaid signups
// and Abandoned signups (both old addresses redirect here, query kept).
//   Tutors                         ONE list (owner, 20 Oct 2026) — the Overview
//                                  lists "Unpaid signups not yet contacted",
//                                  "Stuck in onboarding" and "Started payment,
//                                  didn't finish" are its chips; each tutor is
//                                  one short card (lib/tutorFollowUpCore)
//                                  (SCREEN_ACCESS.unpaidSignups — Tuitions staff too)
//   Parents & email not confirmed  from Abandoned signups (SCREEN_ACCESS.signups)
//   Orphaned accounts              (SCREEN_ACCESS.signups)
// Tuitions staff see the Tutors tab only; the rule is lib/followUpsPageCore.

export const dynamic = 'force-dynamic'

/** The request's clock, read once per tab render. */
const nowMs = () => Date.now()

// Quick filters by sign-up day (owner, 12 Oct 2026) — where the Overview card
// "Signed up today, not paid" lands. Pakistan-time days.
const SIGNED_UP: { key: SignupWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
]

type SP = { tab?: string; filter?: string; scope?: string; chip?: string; q?: string; view?: string; fwd?: string; show?: string; fu?: string; n?: string; nr?: string }

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  // Applications moved to its own page, Tuitions → Applications (owner, 22 Oct
  // 2026). An old Follow-ups → Applications link lands there, filters kept.
  if (sp.tab === 'applications') permanentRedirect(legacyApplicationsHref(sp))
  const actor = await requireAdminRole(...SCREEN_ACCESS.unpaidSignups)
  const tabs = followUpTabsFor(actor.adminRole)
  const tab = pickFollowUpTab(actor.adminRole, sp.tab)
  // Old chips and groups (?filter=onboarding, ?scope=started_payment…) open
  // the merged list on the matching chip, so bookmarks still work.
  if (tab === 'tutors') {
    const to = legacyFollowUpsRedirect({ filter: sp.filter, scope: sp.scope, chip: sp.chip, q: sp.q })
    if (to) redirect(to)
  }

  // Backend Support's own numbers (owner, 31 Oct 2026) — its home is this page.
  const kpi = actor.adminRole === 'backend_support' ? await loadBackendSupportKpi(actor.id) : null

  return (
    <div className="space-y-4">
      {kpi && <BackendSupportKpiView kpi={kpi} />}
      {tabs.length > 1 && (
        <nav aria-label="Tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
          {FOLLOW_UP_TABS.filter((t) => tabs.includes(t.key)).map((t) => (
            <Link
              key={t.key}
              href={followUpsHref(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
                tab === t.key ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {tab === 'tutors' && (
        <TutorsTab
          scope={parseTutorScope(sp.scope)}
          chip={parseFollowChip(sp.chip)}
          window={isSignupWindow(sp.filter) ? sp.filter : null}
          q={(sp.q ?? '').trim()}
          fuTab={parseFuTab(sp.fu)}
          // The roles that see payment amounts (Owner, Partner) — the route checks too.
          canCheckPayment={roleMayWrite(actor.adminRole, ['partner'])}
          isOwner={canApprove(actor.adminRole)}
          refCode={await senderRefCode(actor.id)}
          shown={shownCount(sp.n)}
          shownNoReply={shownCount(sp.nr)}
        />
      )}
      {tab === 'parents' && (
        <ParentsTab showNotInterested={sp.scope === 'not_interested'} fuTab={parseFuTab(sp.fu)} chip={parseParentChip(sp.chip)} shown={shownCount(sp.n)} shownNoReply={shownCount(sp.nr)} />
      )}
      {tab === 'orphans' && <OrphansTab />}
    </div>
  )
}

// ------------------------------------------------------------------ Tutors

async function TutorsTab({
  scope,
  chip,
  window,
  q,
  fuTab,
  canCheckPayment,
  isOwner,
  refCode,
  shown,
  shownNoReply,
}: {
  scope: TutorScope
  chip: ChipFilter
  window: SignupWindow | null
  q: string
  fuTab: FuTab
  canCheckPayment: boolean
  isOwner: boolean
  /** The viewer's staff code: added to every site link in the WhatsApp texts. */
  refCode: string | null
  /** 25 at a time (owner, 28 Oct 2026 — lib/adminPagingCore). */
  shown: number
  shownNoReply: number
}) {
  const now = nowMs()
  // Pre-calculated (owner, 1 Nov 2026 — lib/adminSummary): this group's rows are
  // worked out every minute something changes; the search, chip, sign-up day,
  // To do / Followed up split, counts and 25 rows come from SQL (admin_list_page).
  const list = tutorFuList(scope)
  const range = window ? windowRange(window, now) : null
  const base = { fixed: window ? { feePaid: false } : {}, since: range?.since ?? null, until: range?.until ?? null, q, rows: [{ param: 'chips', value: chip }] }
  const [res, nr, state] = await Promise.all([
    listPage<TutorFollowRow>(list, {
      ...base,
      split: 'tabsec',
      splitValues: [fuTab],
      order: fuTab === 'todo' ? (chip === 'all' ? 'overdue_rank' : 'overdue') : 'sort_asc',
      limit: shown,
    }),
    fuTab === 'sent'
      ? listPage<TutorFollowRow>(list, { ...base, split: 'tabsec', splitValues: ['no_reply'], order: chip === 'all' ? 'overdue_rank' : 'pos', limit: shownNoReply })
      : Promise.resolve(null),
    readSummary(['state']),
  ])
  const builtAt = ((state.get('state')?.payload ?? {}) as { builtAt?: string | null }).builtAt ?? null
  // The viewer's ref is added to the ready-made WhatsApp links here (owner, 23 Oct 2026).
  const withRef = (r: TutorFollowRow) => (refCode ? { ...r, waHref: waHrefWithRef(r.waHref, refCode), feeReplyHref: waHrefWithRef(r.feeReplyHref, refCode) } : r)
  const chipCountsRaw = res.rowCounts.chips ?? {}
  const counts = Object.fromEntries((['all', ...FOLLOW_CHIPS] as ChipFilter[]).map((c) => [c, chipCountsRaw[c] ?? 0])) as Record<ChipFilter, number>
  const tabTotals = { todo: res.split.todo ?? 0, sent: (res.split.sent ?? 0) + (res.split.no_reply ?? 0) }
  const page = sliceFromList(res.rows.map((x) => withRef(x.row)), res.total, shown)
  const noReplyPage = sliceFromList((nr?.rows ?? []).map((x) => withRef(x.row)), nr?.total ?? 0, shownNoReply)
  const noReply = noReplyPage.rows
  const rows = page.rows
  const noReplyAll = { length: noReplyPage.total }
  const shares = await loadProfileShares([...page.rows, ...noReply].map((r) => r.id))
  const href = (o: { scope?: TutorScope; chip?: ChipFilter; window?: SignupWindow | null; fu?: FuTab }) => {
    const sc = o.scope ?? scope
    const ch = o.chip ?? chip
    const win = o.window === undefined ? window : o.window
    const tb = o.fu ?? fuTab
    return followUpsHref('tutors', {
      scope: sc === 'recent' ? undefined : sc,
      chip: ch === 'all' ? undefined : ch,
      filter: win ?? undefined,
      q: q || undefined,
      fu: tb === 'todo' ? undefined : tb,
    })
  }
  const pill = (on: boolean) =>
    `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
      on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
    }`

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Tutors</h2>
        <p className="text-[11px] text-gray-500">{summaryUpdatedLabel(builtAt)}. Lists are worked out every minute something changes.</p>
        <p className="text-xs text-gray-500">
          {scope === 'recent' &&
            `Tutors who joined in the last ${UNPAID_WINDOW_DAYS} days and have not finished, and anyone who started a payment and did not finish.`}
          {scope === 'older' && `Tutors who joined more than ${UNPAID_WINDOW_DAYS} days ago and have not finished.`}
          {scope === 'paid_unfinished' && 'Tutors who paid the Verification Fee and have not finished, whenever they joined.'}
          {scope === 'not_interested' && 'Tutors marked "Not interested". They are on no other list until the mark is undone.'} Finished
          means the Verification Fee is paid, CNIC, photo and selfie are approved and every step is done. Each tutor is listed once.
          Paused, test and staff accounts are left out.
        </p>
      </header>

      <nav aria-label="Which tutors" className="flex flex-wrap gap-2">
        {TUTOR_SCOPES.map((s) => (
          <Link key={s} href={href({ scope: s, window: null })} aria-current={s === scope ? 'page' : undefined} className={pill(s === scope)}>
            {TUTOR_SCOPE_LABEL[s]}
          </Link>
        ))}
      </nav>

      <QueueSearch
        basePath="/admin/follow-ups"
        initialQuery={q}
        filter={window ?? ''}
        keep={{ scope: scope === 'recent' ? undefined : scope, chip: chip === 'all' ? undefined : chip, fu: fuTab === 'todo' ? undefined : fuTab }}
        placeholder="Search by name or city"
        ariaLabel="Search tutors"
      />

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {(['all', ...FOLLOW_CHIPS] as ChipFilter[]).map((c) => (
          <Link key={c} href={href({ chip: c })} aria-current={c === chip ? 'page' : undefined} className={pill(c === chip)}>
            {c === 'all' ? 'All' : FOLLOW_CHIP_LABEL[c]} <span className={c === chip ? 'text-white' : 'text-gray-500'}>{counts[c]}</span>
          </Link>
        ))}
      </nav>

      {scope === 'recent' && (
        <nav aria-label="Signed up" className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-gray-600">Signed up:</span>
          {SIGNED_UP.map((f) => (
            <Link
              key={f.key}
              href={href({ window: window === f.key ? null : f.key })}
              aria-current={f.key === window ? 'page' : undefined}
              className={pill(f.key === window)}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      )}

      <nav aria-label="To do or followed up" className="flex flex-wrap gap-1 border-b border-gray-200">
        {(['todo', 'sent'] as FuTab[]).map((t) => (
          <Link
            key={t}
            href={href({ fu: t })}
            aria-current={t === fuTab ? 'page' : undefined}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${
              t === fuTab ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
            }`}
          >
            {FU_TAB_LABEL[t]} <span className="text-gray-500">{t === 'todo' ? tabTotals.todo : tabTotals.sent}</span>
          </Link>
        ))}
      </nav>
      <p className="text-[11px] text-gray-500">
        {fuTab === 'todo'
          ? 'Tutors to message now. A tutor moves to Followed up when you message them and comes back here 3 days later, even if they finish a new step meanwhile; they then get the message for where they are now. Waiting on us items stay here until the documents are reviewed.'
          : 'Tutors followed up in the last 3 days, soonest due first. After 3 messages with no progress they go to “No reply after 3 messages” and are no longer due.'}
      </p>

      {rows.length === 0 && noReply.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">{fuTab === 'todo' ? 'Nobody to message right now.' : 'Nobody followed up in the last 3 days.'}</p>
      ) : (
        <ul className="space-y-3">
          {page.rows.map((r) => (
            <UnpaidSignupRow key={r.id} row={r} share={shares.get(r.id) ?? null} canCheckPayment={canCheckPayment} isOwner={isOwner} nowMs={now} />
          ))}
        </ul>
      )}
      {page.total > 0 && <LoadMoreLink shown={page.shown} total={page.total} noun="tutors" />}
      {noReplyAll.length > 0 && (
        <details open={shownNoReply > ADMIN_PAGE_SIZE || undefined} className="rounded-2xl border border-gray-200 bg-tm-bg p-3">
          <summary className="min-h-[36px] cursor-pointer text-xs font-black text-tm-navy">No reply after 3 messages ({noReplyPage.total})</summary>
          <ul className="mt-3 space-y-3">
            {noReply.map((r) => (
              <UnpaidSignupRow key={r.id} row={r} share={shares.get(r.id) ?? null} canCheckPayment={canCheckPayment} isOwner={isOwner} nowMs={now} />
            ))}
          </ul>
          <LoadMoreLink shown={noReplyPage.shown} total={noReplyPage.total} noun="tutors" param="nr" />
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------- Parents & email not confirmed

async function ParentsTab({
  showNotInterested,
  fuTab,
  chip,
  shown,
  shownNoReply,
}: {
  showNotInterested: boolean
  fuTab: 'todo' | 'sent'
  chip: ParentChip
  shown: number
  shownNoReply: number
}) {
  // The same To do / Followed up board as Tutors (owner, 26 Oct 2026 —
  // lib/parentFollowUpCore): one situation per parent and its own message.
  // Pre-calculated (owner, 1 Nov 2026 — lib/adminSummary); counted and paged in SQL.
  const pq = { fixed: { ni: showNotInterested }, rows: [{ param: 'pchip', value: chip }], split: 'tabsec' }
  const [res, nr, fu] = await Promise.all([
    listPage<ParentRow>(PARENT_FU_LIST, { ...pq, splitValues: [fuTab], order: fuTab === 'todo' ? 'overdue_sort' : 'pos', limit: shown }),
    fuTab === 'sent' ? listPage<ParentRow>(PARENT_FU_LIST, { ...pq, splitValues: ['no_reply'], order: 'pos', limit: shownNoReply }) : Promise.resolve(null),
    readSummary(['fu']),
  ])
  const notInterestedCount = ((fu.get('fu')?.payload ?? {}) as { parentNotInterested?: number }).parentNotInterested ?? 0
  const pchip = res.rowCounts.pchip ?? {}
  const toCard = (r: ParentRow): ParentCard => ({
    id: r.id,
    name: r.name,
    city: r.city,
    joinedAt: r.joinedAt,
    reason: r.reason,
    tuition: r.tuition ? { title: r.tuition.title, path: r.tuition.path } : null,
    state: r.state,
    hasNumber: r.hasNumber,
    hasEmail: r.hasEmail,
    notInterested: r.notInterested,
  })
  const todoCount = res.split.todo ?? 0
  const sentCount = res.split.sent ?? 0
  const noReplyCount = res.split.no_reply ?? 0
  const listTotal = res.total
  const base = { scope: showNotInterested ? 'not_interested' : undefined, chip: chip === 'all' ? undefined : chip }

  return (
    <div className="space-y-3">
      <nav aria-label="Which parents" className="flex flex-wrap gap-2">
        <Link href={followUpsHref('parents', { chip: base.chip })} aria-current={!showNotInterested ? 'page' : undefined} className={groupPill(!showNotInterested)}>
          Not finished
        </Link>
        <Link
          href={followUpsHref('parents', { scope: 'not_interested', chip: base.chip })}
          aria-current={showNotInterested ? 'page' : undefined}
          className={groupPill(showNotInterested)}
        >
          Not interested <span className={showNotInterested ? 'text-white' : 'text-gray-500'}>{notInterestedCount}</span>
        </Link>
      </nav>
      <nav aria-label="To do or followed up" className="flex flex-wrap gap-1 border-b border-gray-200" data-parent-tabs="">
        {(['todo', 'sent'] as const).map((t) => (
          <Link
            key={t}
            href={followUpsHref('parents', { ...base, fu: t === 'sent' ? 'sent' : undefined })}
            aria-current={fuTab === t ? 'page' : undefined}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${fuTab === t ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'}`}
          >
            {FU_TAB_LABEL[t]} <span className="text-gray-500">{t === 'todo' ? todoCount : sentCount + noReplyCount}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter parents" className="flex flex-wrap gap-2">
        {(Object.keys(PARENT_CHIP_LABEL) as ParentChip[]).map((c) => (
          <Link
            key={c}
            href={followUpsHref('parents', { ...base, chip: c === 'all' ? undefined : c, fu: fuTab === 'sent' ? 'sent' : undefined })}
            aria-current={chip === c ? 'page' : undefined}
            className={groupPill(chip === c)}
          >
            {PARENT_CHIP_LABEL[c]} <span className={chip === c ? 'text-white' : 'text-gray-500'}>{pchip[c] ?? 0}</span>
          </Link>
        ))}
      </nav>
      {/* 25 at a time (owner, 28 Oct 2026); the counts above are over the whole list. */}
      <ParentFollowUpsBoard cards={res.rows.map((x) => toCard(x.row))} noReply={fuTab === 'sent' ? (nr?.rows ?? []).map((x) => toCard(x.row)) : []} />
      {listTotal > 0 && <LoadMoreLink shown={Math.min(shown, listTotal)} total={listTotal} noun="parents" />}
      {fuTab === 'sent' && noReplyCount > shownNoReply && <LoadMoreLink shown={shownNoReply} total={noReplyCount} noun="parents with no reply" param="nr" />}
    </div>
  )
}

const groupPill = (on: boolean) =>
  `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
    on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
  }`

// ------------------------------------------------------------- Orphaned accounts

async function OrphansTab() {
  const orphans = await loadOrphanedAccounts()
  return <OrphansSection rows={orphans.rows} ok={orphans.ok} />
}

