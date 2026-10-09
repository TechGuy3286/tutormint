import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadUnpaidSignups } from '@/lib/staffOutreach'
import { parseUnpaidFilter, unpaidRowMatches, UNPAID_WINDOW_DAYS, type UnpaidFilter } from '@/lib/staffOutreachCore'
import UnpaidSignupRow from './UnpaidSignupRow'
import { loadFollowUpStates } from '@/lib/followUps'
import { followUpLine } from '@/lib/followUpCore'

// Admin → People → Unpaid signups (owner, 8 Oct 2026). Tutors who signed up in
// the last 30 days and have not paid the Spam Free Platform Fee, newest first —
// paused and test accounts left out. Each row: where they stopped, a WhatsApp
// and a Call button, and the last contact. Owner, admin, Operations and
// Tuitions staff (SCREEN_ACCESS.unpaidSignups).

export const dynamic = 'force-dynamic'

const FILTERS: { key: UnpaidFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'payment', label: 'Stopped at payment' },
  { key: 'onboarding', label: 'Stuck in onboarding' },
  { key: 'uncontacted', label: 'Not contacted yet' },
  { key: 'followed', label: 'Follow-up sent' },
]

export default async function UnpaidSignupsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.unpaidSignups)
  const filter = parseUnpaidFilter((await searchParams).filter)
  const all = await loadUnpaidSignups()
  // The shared follow-up record (owner, 9 Oct 2026): followed up in the last 7
  // days → the Follow-up sent tab; older → back, tagged "Followed up once".
  const now = Date.now()
  const states = await loadFollowUpStates(all.map((r) => r.id))
  const facts = (r: (typeof all)[number]) => ({
    stoppedAt: r.stoppedAt,
    lastContactAt: r.lastContact?.at ?? null,
    followUpSent: !!states.get(r.id)?.sent,
  })
  const rows = all.filter((r) => unpaidRowMatches(facts(r), filter))
  const count = (f: UnpaidFilter) => all.filter((r) => unpaidRowMatches(facts(r), f)).length

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Unpaid signups</h1>
        <p className="text-xs text-gray-500">
          Tutors who joined in the last {UNPAID_WINDOW_DAYS} days and have not paid the Spam Free Platform Fee, newest
          first. Paused, test and staff accounts are left out. Log every call so nobody is rung twice.
        </p>
      </header>

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.key === filter
          return (
            <Link
              key={f.key}
              href={f.key === 'all' ? '/admin/users/unpaid-signups' : `/admin/users/unpaid-signups?filter=${f.key}`}
              aria-current={on ? 'page' : undefined}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
              }`}
            >
              {f.label} <span className={on ? 'text-white' : 'text-gray-500'}>{count(f.key)}</span>
            </Link>
          )
        })}
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
