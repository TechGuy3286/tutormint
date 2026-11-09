import Link from 'next/link'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { readSummary, summaryUpdatedLabel } from '@/lib/adminSummary'
import {
  dailyBars,
  PAID_PERIODS,
  PAID_TARGET,
  parsePeriod,
  periodCounts,
  periodRange,
  targetPace,
  whoBrought,
  type PaidSignupsPayload,
} from '@/lib/paidSignupsCore'

// Paid sign-ups (owner, 9 Nov 2026) — opened from the Overview "Paid" card.
// Paid tutor sign-ups per period, a 30-day bar chart against the monthly
// target of 700, and who brought them in the chosen period. Counts only, never
// rupees, so Backend Support sees it. Pakistan time throughout. Read from the
// pre-calculated summary (lib/paidSignups, key 'paidsignups'); the rules are
// lib/paidSignupsCore.

export const dynamic = 'force-dynamic'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export default async function PaidSignupsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.paidSignups)
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const summary = await readSummary(['paidsignups', 'state'])
  const payload = (summary.get('paidsignups')?.payload ?? { rows: [], names: {} }) as PaidSignupsPayload
  const builtAt = ((summary.get('state')?.payload ?? {}) as { builtAt?: string | null }).builtAt ?? null
  const now = Date.now()
  const counts = periodCounts(payload.rows, now)
  const bars = dailyBars(payload.rows, now, 30)
  const pace = targetPace(payload.rows, now)
  const who = whoBrought(payload.rows, periodRange(period, now), payload.names)
  const whoTotal = who.reduce((s, r) => s + r.count, 0)
  const maxBar = Math.max(1, ...bars.map((b) => b.count))
  const seesPaidList = roleSatisfies(actor.adminRole, SCREEN_ACCESS.payments)
  const periodLabel = PAID_PERIODS.find((p) => p.key === period)?.label ?? 'This month'

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-tm-navy">Paid sign-ups</h2>
        <p className="text-xs text-gray-500">
          Tutors who paid the Verification Fee, each counted once on the day it was approved (Pakistan time). Staff and test accounts are left
          out. Updated {summaryUpdatedLabel(builtAt)}.
        </p>
      </header>

      <section aria-label="Paid sign-ups per period" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {counts.map((c) => (
          <div key={c.key} className="rounded-2xl border border-gray-200 bg-white p-3" data-period={c.key}>
            <p className="text-[11px] font-bold text-gray-500">{c.label}</p>
            <p className="text-2xl font-black text-tm-navy">{fmt(c.count)}</p>
            {c.change && (
              <p className={`text-[11px] font-bold ${c.change.diff > 0 ? 'text-tm-green-deep' : c.change.diff < 0 ? 'text-tm-red' : 'text-gray-500'}`}>
                {c.change.arrow} {c.change.diff > 0 ? '+' : ''}
                {fmt(c.change.diff)} vs {fmt(c.change.prev)}
              </p>
            )}
          </div>
        ))}
      </section>

      <section aria-label="Monthly target" className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-black text-tm-navy" data-target="">
          This month: {fmt(pace.paid)} of {fmt(PAID_TARGET)}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden>
          <div className="h-2 rounded-full bg-tm-green-deep" style={{ width: `${Math.min(100, Math.round((pace.paid / pace.target) * 100))}%` }} />
        </div>
        <p className="text-xs text-slate-700">
          {pace.reached
            ? 'Target reached ✓'
            : `${fmt(pace.left)} to go · ${pace.perDay} a day needed over the ${pace.daysLeft} ${pace.daysLeft === 1 ? 'day' : 'days'} left (today included)`}
        </p>
      </section>

      <section aria-label="Last 30 days" className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-black text-tm-navy">Last 30 days</p>
        <div className="flex h-40 items-end gap-[2px]" role="img" aria-label={`Paid sign-ups per day for the last 30 days, highest ${maxBar}`}>
          {bars.map((b) => (
            <div key={b.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.day}: ${b.count}`}>
              <div className="w-full rounded-t bg-tm-navy" style={{ height: `${(b.count / maxBar) * 100}%`, minHeight: b.count ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>{bars[0]?.day}</span>
          <span>Highest day: {fmt(maxBar === 1 && !bars.some((b) => b.count) ? 0 : maxBar)}</span>
          <span>{bars[bars.length - 1]?.day}</span>
        </div>
      </section>

      <section aria-label="Who brought them" className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-black text-tm-navy">Who brought them — {periodLabel.toLowerCase()}</p>
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {PAID_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === 'this_month' ? '/admin/paid-signups' : `/admin/paid-signups?period=${p.key}`}
              aria-current={p.key === period ? 'page' : undefined}
              className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-[11px] font-bold ${
                p.key === period ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        {who.length === 0 ? (
          <p className="text-xs text-gray-500">No paid sign-ups in this period.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 font-bold">Brought by</th>
                <th className="py-1 text-right font-bold">Paid sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {who.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-1.5 text-slate-800">{r.name}</td>
                  <td className="py-1.5 text-right font-bold text-tm-navy">{fmt(r.count)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200">
                <td className="py-1.5 font-black text-tm-navy">Total</td>
                <td className="py-1.5 text-right font-black text-tm-navy">{fmt(whoTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-gray-500">
          Credit follows the existing rules: a staff member&apos;s join link or code, or an approved claim. Self = signed up with no staff link.
          Admin = a staff link whose credit was refused under the rules (a self-referral).
        </p>
      </section>

      {seesPaidList && (
        <p className="text-xs">
          <Link href="/admin/overview/paid-today" className="font-bold text-tm-red hover:underline">
            See who paid today
          </Link>
        </p>
      )}
    </div>
  )
}
