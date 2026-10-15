import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadUnpaidSignups } from '@/lib/staffOutreach'
import { parseUnpaidFilter, unpaidRowMatches, UNPAID_WINDOW_DAYS, type UnpaidFilter } from '@/lib/staffOutreachCore'
import { loadFollowUpStates } from '@/lib/followUps'
import { followUpLine } from '@/lib/followUpCore'
import { loadAbandonedSignups } from '@/lib/abandonedSignups'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { loadTemplates } from '@/lib/adminMessaging'
import {
  FOLLOW_UP_TABS,
  followUpTabsFor,
  followUpsHref,
  onParentsTab,
  pickFollowUpTab,
} from '@/lib/followUpsPageCore'

import UnpaidSignupRow from './UnpaidSignupRow'
import SignupsClient from './SignupsClient'
import OrphansSection from './OrphansSection'

// People → Follow-ups (owner, 15 Oct 2026): ONE page in place of Unpaid signups
// and Abandoned signups (both old addresses redirect here, query kept).
//   Tutors                         the Unpaid signups list, unchanged
//                                  (SCREEN_ACCESS.unpaidSignups — Tuitions staff too)
//   Parents & email not confirmed  from Abandoned signups (SCREEN_ACCESS.signups)
//   Orphaned accounts              (SCREEN_ACCESS.signups)
// Tuitions staff see the Tutors tab only; the rule is lib/followUpsPageCore.

export const dynamic = 'force-dynamic'

/** The request's clock, read once per tab render. */
const nowMs = () => Date.now()

const FILTERS: { key: UnpaidFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'payment', label: 'Stopped at payment' },
  { key: 'onboarding', label: 'Stuck in onboarding' },
  { key: 'uncontacted', label: 'Not contacted yet' },
  { key: 'followed', label: 'Follow-up sent' },
]

// Quick filters by sign-up day (owner, 12 Oct 2026) — where the Overview card
// "Signed up today, not paid" lands. Pakistan-time days.
const SIGNED_UP: { key: UnpaidFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
]

const SIGNUP_TEMPLATE_KEYS = ['signup_email_unconfirmed', 'signup_profile_unfinished'] as const

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.unpaidSignups)
  const sp = await searchParams
  const tabs = followUpTabsFor(actor.adminRole)
  const tab = pickFollowUpTab(actor.adminRole, sp.tab)

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
      {tab === 'tutors' && <TutorsTab filterParam={sp.filter} />}
      {tab === 'parents' && <ParentsTab />}
      {tab === 'orphans' && <OrphansTab />}
    </div>
  )
}

// ------------------------------------------------------------------ Tutors

async function TutorsTab({ filterParam }: { filterParam?: string }) {
  const filter = parseUnpaidFilter(filterParam)
  const all = await loadUnpaidSignups()
  // The shared follow-up record (owner, 9 Oct 2026): followed up in the last 7
  // days → the Follow-up sent tab; older → back, tagged "Followed up once".
  const now = nowMs()
  const states = await loadFollowUpStates(all.map((r) => r.id))
  const facts = (r: (typeof all)[number]) => ({
    stoppedAt: r.stoppedAt,
    lastContactAt: r.lastContact?.at ?? null,
    followUpSent: !!states.get(r.id)?.sent,
    joinedAt: r.joinedAt,
  })
  const rows = all.filter((r) => unpaidRowMatches(facts(r), filter, now))
  const count = (f: UnpaidFilter) => all.filter((r) => unpaidRowMatches(facts(r), f, now)).length
  const chip = (on: boolean) =>
    `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
      on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
    }`

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Tutors</h2>
        <p className="text-xs text-gray-500">
          Tutors who joined in the last {UNPAID_WINDOW_DAYS} days and have not paid the Verification Fee, newest
          first. Paused, test and staff accounts are left out. Log every call so nobody is rung twice.
        </p>
      </header>

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={followUpsHref('tutors', { filter: f.key === 'all' ? undefined : f.key })}
            aria-current={f.key === filter ? 'page' : undefined}
            className={chip(f.key === filter)}
          >
            {f.label} <span className={f.key === filter ? 'text-white' : 'text-gray-500'}>{count(f.key)}</span>
          </Link>
        ))}
      </nav>

      <nav aria-label="Signed up" className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-gray-600">Signed up:</span>
        {SIGNED_UP.map((f) => (
          <Link
            key={f.key}
            href={followUpsHref('tutors', { filter: f.key })}
            aria-current={f.key === filter ? 'page' : undefined}
            className={chip(f.key === filter)}
          >
            {f.label} <span className={f.key === filter ? 'text-white' : 'text-gray-500'}>{count(f.key)}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nobody here right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <UnpaidSignupRow
              key={r.id}
              row={r}
              followUp={{
                tab: states.get(r.id)?.sent ? 'sent' : 'stuck',
                line: states.get(r.id) ? followUpLine(states.get(r.id)!, now) : null,
                tag: states.get(r.id)?.tag ?? null,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------- Parents & email not confirmed

async function ParentsTab() {
  const [{ rows: allRows, ok }, templates] = await Promise.all([loadAbandonedSignups(), loadTemplates()])
  // Tutors who have not finished are on the Tutors tab, never on two tabs.
  const rows = allRows.filter(onParentsTab)

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

  return <SignupsClient rows={rows} ok={ok} templateBodies={bodies} followUps={followUps} />
}

// ------------------------------------------------------------- Orphaned accounts

async function OrphansTab() {
  const orphans = await loadOrphanedAccounts()
  return <OrphansSection rows={orphans.rows} ok={orphans.ok} />
}
