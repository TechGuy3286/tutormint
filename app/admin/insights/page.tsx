import Link from 'next/link'
import { requireInsights } from '@/lib/staffAllRows'
import { loadInsightsPeriod } from '@/lib/insights'
import { labelsForMasterIdsServer } from '@/lib/taxonomyServer'
import { ACTION_GROUPS, WEEKDAYS, pkDayOf, requestNowMs, resolvePeriod, type InsightsPeriod, type SearchRow } from '@/lib/insightsCore'
import { stepChange, type FunnelStep } from '@/lib/signupFunnelCore'
import PeriodPicker from './PeriodPicker'
import ActiveChart from './ActiveChart'

// Admin → Insights (owner, 20 Nov 2026 — PR-12). The Owner and the Project
// Managers (SCREEN_ACCESS.insights) and, since PR-16, the account on the
// "staff.insights" grant (Mohsin). Counts only: members appear by name
// on the drill-down list with a link to their admin page — never a phone,
// email, CNIC or rupee figure. The numbers are pre-built per Pakistan day by
// the 5-minute cron (lib/insights.ts); this page merges the chosen days.

export const dynamic = 'force-dynamic'

type SP = { period?: string; from?: string; to?: string }

const card = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4'
const h3 = 'text-sm font-black text-tm-navy'
const fmt = (n: number) => n.toLocaleString('en-PK')

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SP> }) {
  // PR-16: Owner, Partner, or the named account on the Insights grant.
  await requireInsights()
  const sp = await searchParams
  const nowMs = requestNowMs()
  const p = resolvePeriod(sp, nowMs)
  const data = await loadInsightsPeriod(p.from, p.to, { nowMs, buildMissing: 2 })
  const subjectLabel = await subjectLabels([...data.searches, ...data.zeroSearches])
  const q = `from=${p.from}&to=${p.to}`

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-lg font-black text-tm-navy">Insights</h2>
        <p className="text-xs text-slate-700">
          What members and visitors did, {p.label.toLowerCase().startsWith('last') ? p.label.toLowerCase() : p.label} (Pakistan time). Member counts leave out staff, seed,
          test, team, hidden, merged and erase-requested accounts (the People rule); staff actions such as tuitions posted and applications forwarded are
          counted. Every shared count here is the same number as on the Overview. Counts only — no amounts.
        </p>
        {/* Keyed on the period, so the date boxes always show the chosen chip's dates (PR-22). */}
        <PeriodPicker key={`${p.key}:${p.from}:${p.to}`} active={p.key} from={p.from} to={p.to} today={pkDayOf(nowMs)} />
        {data.builtDays < data.totalDays && (
          <p role="status" className="rounded-xl bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink">
            {data.builtDays} of {data.totalDays} days are ready. The rest are being prepared — open this page again in a few minutes.
          </p>
        )}
      </header>

      <section className={card}>
        <h3 className={h3}>Active users</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Active tutors" value={data.totals.tutors} />
          <Stat label="Active parents" value={data.totals.parents} />
          <Stat label="Page visits (signed out)" value={data.totals.pageVisits} note="Same as Overview “Public page visits”" />
          <Stat label="Unique visitors (signed out)" value={data.totals.visitorDays} note="Each visitor once a day, days added up" />
          <Stat label="New sign-ups" value={data.totals.newSignups} note="New tutors + new parents" />
          <Stat label="New tutors" value={data.totals.newTutors} note="Same as Overview" />
          <Stat label="New parents" value={data.totals.newParents} note="Same as Overview" />
          <Stat label="Returning members" value={data.totals.returning} note="Active, joined earlier" />
        </div>
        <ActiveChart daily={data.daily} />
        <p className="text-[11px] text-slate-700">
          Active tutors and parents are counted once each over the period. Page visits count every page a signed-out visitor opened — the same counter as the
          Overview “Daily sign-up funnel”. Unique visitors count each signed-out visitor once per day (we cannot tell the same visitor on two days apart, by
          design). Both count real people only: bots and our own crawls are left out, and from 24 Nov 2026 a visit counts once the person taps, scrolls or
          types, or keeps the page open for 8 seconds (22–23 Nov include a crawl that ran page scripts).
        </p>
        {data.totals.heldParents > 0 && (
          <p className="text-[11px] font-bold text-slate-700" data-held-note="">
            Activity of {fmt(data.totals.heldParents)} held {data.totals.heldParents === 1 ? 'parent' : 'parents'} (burst check) is left out of the activity numbers.
          </p>
        )}
      </section>

      <section className={card}>
        <h3 className={h3}>What people did</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {ACTION_GROUPS.map((g) => (
            <div key={g.key} className="rounded-xl border border-gray-200 p-3">
              <p className="text-xs font-black text-tm-navy">{g.label}</p>
              <ul className="mt-1 divide-y divide-gray-100">
                {g.items.map((i) => (
                  <li key={i.key} className="flex min-h-[44px] items-center justify-between gap-2 text-xs text-slate-700">
                    <span>{i.label}</span>
                    {data.actions[i.key] > 0 ? (
                      <Link href={`/admin/insights/members?action=${i.key}&${q}`} className="font-black text-tm-navy underline-offset-2 hover:underline">
                        {fmt(data.actions[i.key])}
                      </Link>
                    ) : (
                      <span className="font-bold">0</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-700">
          Tap a number to see the members behind it. New sign-ups, Mobile verified, Tutors finished onboarding, Tuitions posted, Applications,
          Applications forwarded, Verification Fee paid and Plans bought are the shared counts — each account or item once, the same on every screen.
          WhatsApp and Call taps are counted from 20 Nov 2026.
        </p>
      </section>

      <section className={card}>
        <h3 className={h3}>Searches on Browse tutors and Browse tuitions</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          <SearchTable title="Top searches" rows={data.searches} by="n" label={subjectLabel} empty="No searches in this period yet. Try Last 30 days." />
          <SearchTable title="Searches with zero results" rows={data.zeroSearches} by="zero" label={subjectLabel} empty="No search came back empty in this period." />
        </div>
        <p className="text-[11px] text-slate-700">
          A line with no filter is a search by typed words only — the words themselves are on{' '}
          <Link href="/admin/search-words" className="font-bold text-tm-navy underline-offset-2 hover:underline">Search words</Link>.
          {data.totals.failedSearches > 0
            ? ` ${fmt(data.totals.failedSearches)} ${data.totals.failedSearches === 1 ? 'search' : 'searches'} failed (took too long) — not counted as zero results.`
            : ' A search that failed (took too long) is never counted as a zero result.'}
        </p>
      </section>

      <section className={card}>
        <h3 className={h3}>Where people drop off</h3>
        <p className="text-[11px] text-slate-700">
          People who signed up in this period, in the order of the sign-up flow. Each step counts only those who reached every step before it, so a step is
          never higher than the one above it.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <Funnel title="Tutors" steps={data.funnelTutor} />
          <Funnel title="Parents" steps={data.funnelParent} />
        </div>
      </section>

      <section className={card}>
        <h3 className={h3}>When people are active</h3>
        <p className="text-[11px] text-slate-700">Page views and actions by day of the week and hour (Pakistan time). Darker = busier.</p>
        <HeatGrid data={data} />
      </section>

      <section className={card}>
        <h3 className={h3}>Devices</h3>
        <p className="text-xs font-bold text-tm-navy">Device type</p>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Mobile" value={data.device.mobile} />
          <Stat label="Tablet" value={data.device.tablet} />
          <Stat label="Desktop" value={data.device.desktop} />
        </div>
        <p className="text-xs font-bold text-tm-navy">System</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Android" value={data.device.android} />
          <Stat label="iPhone / iPad" value={data.device.iphone} />
          <Stat label="Windows" value={data.device.windows ?? 0} />
          <Stat label="Mac" value={data.device.mac ?? 0} />
          <Stat label="Other" value={data.device.other} />
        </div>
        <p className="text-[11px] text-slate-700">
          Each visitor and member once per day; bots are never counted. Only the device type and system are kept, never the full browser details. Windows and
          Mac are told apart from 24 Nov 2026 — before that they were under Other.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl bg-tm-bg p-3">
      <p className="text-lg font-black text-tm-navy">{fmt(value)}</p>
      <p className="text-[11px] font-bold text-slate-700">{label}</p>
      {note && <p className="text-[10px] text-slate-700">{note}</p>}
    </div>
  )
}

async function subjectLabels(rows: SearchRow[]): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.masterId).filter((x): x is number => x != null))]
  const out = new Map<number, string>()
  await Promise.all(
    ids.map(async (id) => {
      const [l] = await labelsForMasterIdsServer([id]).catch(() => [])
      if (l) out.set(id, l)
    }),
  )
  return out
}

function SearchTable({ title, rows, by, label, empty }: { title: string; rows: SearchRow[]; by: 'n' | 'zero'; label: Map<number, string>; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-black text-tm-navy">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-700">{empty}</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {rows.map((r, i) => {
            const parts = [
              r.surface === 'tutors' ? 'Tutors' : r.surface === 'tuitions' ? 'Tuitions' : r.surface,
              r.masterId != null ? (label.get(r.masterId) ?? 'a subject') : null,
              [r.area, r.city].filter(Boolean).join(', ') || null,
              r.mode,
              r.gender,
            ].filter(Boolean)
            return (
              <li key={i} className="flex min-h-[36px] items-center justify-between gap-2 text-xs text-slate-700">
                <span className="min-w-0 break-words">{parts.join(' · ')}</span>
                <span className="shrink-0 font-black text-tm-navy">{fmt(r[by])}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Funnel({ title, steps }: { title: string; steps: FunnelStep[] }) {
  const top = Math.max(1, steps[0]?.count ?? 0)
  return (
    <div className="space-y-1 rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-black text-tm-navy">{title}</p>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.key} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-700">
              <span>{s.label}</span>
              <span>
                <b className="text-tm-navy">{fmt(s.count)}</b>
                {(() => {
                  const ch = stepChange(s)
                  return ch ? <span className={`ml-2 ${ch.tone === 'lost' ? 'text-tm-red' : ch.tone === 'gained' ? 'text-tm-navy' : 'text-tm-green-deep'}`}>{ch.text}</span> : null
                })()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-tm-navy" style={{ width: `${Math.round((s.count / top) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

const HEAT = ['bg-gray-100', 'bg-tm-navy/15', 'bg-tm-navy/30', 'bg-tm-navy/50', 'bg-tm-navy/70', 'bg-tm-navy']

function HeatGrid({ data }: { data: InsightsPeriod }) {
  const level = (n: number) => (n <= 0 || data.gridMax <= 0 ? 0 : Math.min(5, Math.ceil((n / data.gridMax) * 5)))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0.5 text-[10px] text-slate-700">
        <thead>
          <tr>
            <th className="w-9" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-bold">
                {h % 3 === 0 ? h : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.grid.map((row, w) => (
            <tr key={w}>
              <th className="pr-1 text-left font-bold">{WEEKDAYS[w]}</th>
              {row.map((n, h) => (
                <td key={h} title={`${WEEKDAYS[w]} ${String(h).padStart(2, '0')}:00 — ${n}`} className={`h-5 rounded-sm ${HEAT[level(n)]}`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
