import Link from 'next/link'
import { permanentRedirect, redirect } from 'next/navigation'

import { requireAdminRole, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminActor } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { loadNotInterested } from '@/lib/followUpDismissals'
import { loadDirectory } from '@/lib/peopleDirectory'
import { loadProfileShares } from '@/lib/profileShare'
import {
  isSignupWindow,
  parseTutorScope,
  signedUpIn,
  TUTOR_SCOPE_LABEL,
  TUTOR_SCOPES,
  UNPAID_WINDOW_DAYS,
  type SignupWindow,
  type TutorScope,
} from '@/lib/staffOutreachCore'
import { loadFollowUpStates } from '@/lib/followUps'
import { followUpLine } from '@/lib/followUpCore'
import { loadAbandonedSignups } from '@/lib/abandonedSignups'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { loadTemplates } from '@/lib/adminMessaging'
import { loadTutorFollowUps } from '@/lib/tutorFollowUps'
import {
  chipCounts,
  FOLLOW_CHIP_LABEL,
  FOLLOW_CHIPS,
  legacyFollowUpsRedirect,
  parseFollowChip,
  rowsForChip,
  type ChipFilter,
  type FollowChip,
} from '@/lib/tutorFollowUpCore'
import {
  FOLLOW_UP_TABS,
  followUpTabsFor,
  followUpsHref,
  onParentsTab,
  pickFollowUpTab,
} from '@/lib/followUpsPageCore'
import QueueSearch from '@/components/admin/QueueSearch'
import { FU_TAB_LABEL, parseFuTab, tabCounts, type FuTab } from '@/lib/tutorFollowUpTabsCore'

import { legacyApplicationsHref } from '@/lib/applicationStageCore'

import UnpaidSignupRow from './UnpaidSignupRow'
import SignupsClient from './SignupsClient'
import OrphansSection from './OrphansSection'

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

const SIGNUP_TEMPLATE_KEYS = ['signup_email_unconfirmed', 'signup_profile_unfinished'] as const

type SP = { tab?: string; filter?: string; scope?: string; chip?: string; q?: string; view?: string; fwd?: string; show?: string; fu?: string }

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

  return (
    <div className="space-y-4">
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
        />
      )}
      {tab === 'parents' && <ParentsTab showNotInterested={sp.scope === 'not_interested'} />}
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
}: {
  scope: TutorScope
  chip: ChipFilter
  window: SignupWindow | null
  q: string
  fuTab: FuTab
  canCheckPayment: boolean
  isOwner: boolean
}) {
  const now = nowMs()
  let all = await loadTutorFollowUps(scope)
  // "Signed up today, not paid" (the Overview card): the fee-unpaid tutors who
  // joined in the window — its number is the length of "Today".
  if (window) all = all.filter((r) => !r.feePaid && signedUpIn(r.joinedAt, window, now))
  const needle = q.toLowerCase()
  if (needle) all = all.filter((r) => [r.name, r.city].some((v) => (v ?? '').toLowerCase().includes(needle)))
  // To do / Followed up (owner, 23 Oct 2026): counted over the group, search and chip.
  const items = all.map((r) => ({ row: r, chips: new Set<FollowChip>(r.chips), primary: r.primary }))
  const counts = chipCounts(items)
  const chipRows = rowsForChip(items, chip).map((x) => x.row)
  const tabTotals = tabCounts(chipRows.map((r) => r.state))
  const inTab = chipRows.filter((r) => r.state.tab === fuTab)
  // To do: overdue first, then the rest in the chip's order. Followed up: soonest due first.
  const rows =
    fuTab === 'todo'
      ? [...inTab.filter((r) => r.state.overdue), ...inTab.filter((r) => !r.state.overdue)]
      : inTab.filter((r) => r.state.section === 'sent').sort((a, b) => Date.parse(a.state.dueAt ?? '') - Date.parse(b.state.dueAt ?? ''))
  const noReply = fuTab === 'sent' ? inTab.filter((r) => r.state.section === 'no_reply') : []
  const shares = await loadProfileShares([...rows, ...noReply].map((r) => r.id))
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
          {rows.map((r) => (
            <UnpaidSignupRow key={r.id} row={r} share={shares.get(r.id) ?? null} canCheckPayment={canCheckPayment} isOwner={isOwner} nowMs={now} />
          ))}
        </ul>
      )}
      {noReply.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-tm-bg p-3">
          <summary className="min-h-[36px] cursor-pointer text-xs font-black text-tm-navy">No reply after 3 messages ({noReply.length})</summary>
          <ul className="mt-3 space-y-3">
            {noReply.map((r) => (
              <UnpaidSignupRow key={r.id} row={r} share={shares.get(r.id) ?? null} canCheckPayment={canCheckPayment} isOwner={isOwner} nowMs={now} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------- Parents & email not confirmed

async function ParentsTab({ showNotInterested }: { showNotInterested: boolean }) {
  const [{ rows: allRows, ok }, templates, directory, dismissed] = await Promise.all([
    loadAbandonedSignups(),
    loadTemplates(),
    loadDirectory(),
    loadNotInterested(),
  ])
  // Staff and test accounts are left out by the People page's rule; tutors are
  // on the Tutors tab, never on two tabs.
  const excluded = new Set(directory.people.filter((p) => p.excluded !== null).map((p) => p.id))
  const listed = allRows.filter((r) => onParentsTab(r) && !excluded.has(r.userId))
  const rows = listed.filter((r) => dismissed.has(r.userId) === showNotInterested)
  const notInterestedCount = listed.filter((r) => dismissed.has(r.userId)).length

  // Pass only the signup templates the client needs, as a plain map.
  const bodies: Record<string, string> = {}
  for (const t of templates) {
    if ((SIGNUP_TEMPLATE_KEYS as readonly string[]).includes(t.key)) bodies[t.key] = t.body
  }

  // The shared follow-up record (owner, 9 Oct 2026).
  const now = nowMs()
  const states = await loadFollowUpStates(rows.map((r) => r.userId))
  const followUps: Record<string, { sent: boolean; line: string | null; tag: string | null }> = {}
  for (const r of rows) {
    const st = states.get(r.userId)
    if (st) followUps[r.userId] = { sent: st.sent, line: followUpLine(st, now), tag: st.tag }
  }

  return (
    <div className="space-y-3">
      <nav aria-label="Which parents" className="flex flex-wrap gap-2">
        <Link href={followUpsHref('parents')} aria-current={!showNotInterested ? 'page' : undefined} className={groupPill(!showNotInterested)}>
          Not finished
        </Link>
        <Link
          href={followUpsHref('parents', { scope: 'not_interested' })}
          aria-current={showNotInterested ? 'page' : undefined}
          className={groupPill(showNotInterested)}
        >
          Not interested <span className={showNotInterested ? 'text-white' : 'text-gray-500'}>{notInterestedCount}</span>
        </Link>
      </nav>
      <SignupsClient rows={rows} ok={ok} templateBodies={bodies} followUps={followUps} notInterested={showNotInterested} />
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

