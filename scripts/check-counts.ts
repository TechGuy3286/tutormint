/**
 * scripts/check-counts.ts — PR-14. READ-ONLY on production: computes, writes nothing.
 *
 * For Today, Yesterday, Last 7 days and This month, works out every shared
 * admin count (lib/countsCore COUNT_DEFS) from EACH screen's own data path —
 * lib/counts itself, the Overview card loaders and the Signup-to-payment
 * funnel, Insights (each day built fresh, then merged as the page merges them,
 * plus its drill-down lists), the daily sign-up funnel, and Paid sign-ups — and
 * fails when any two disagree. The stored copies (Insights days in
 * admin_summary) are compared too but only reported: they are caches the cron
 * refreshes (today every 10 minutes) and may lag by design.
 * Prints counts only — never a name, phone, email or id.
 *
 *   npm run check:counts
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { withRunMemo } from '@/lib/runMemo'
import { countsFor } from '@/lib/counts'
import { COUNT_DEFS, COUNT_KEYS, COUNT_PERIODS, compareSources, countSpan, spanDays, type CountKey, type CountSource } from '@/lib/countsCore'
import { loadOverviewList } from '@/lib/overviewItems'
import { buildInsightsDay, insightMembers, loadInsightsPeriod } from '@/lib/insights'
import { mergePeriod, SHARED_ACTION_COUNT, type ActionKey, type InsightsDay } from '@/lib/insightsCore'
import { loadSignupFunnel } from '@/lib/siteVisits'
import { loadPaidSignupMembers } from '@/lib/paidSignups'
import { directoryCounts } from '@/lib/peopleDirectory'

const num = (s: string | undefined) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('no service client')
  const nowMs = Date.now()
  const now = new Date(nowMs)
  console.log(`check:counts — ${now.toISOString()} (read-only)`)

  let failed = 0
  await withRunMemo(async () => {
    const [tutorsCard, parentsCard, tuitionsCard, paidCard, funnel7, daily, paidMembers, dirCounts] = await Promise.all([
      loadOverviewList('tutors', { now }),
      loadOverviewList('parents', { now }),
      loadOverviewList('open-tuitions', { now }),
      loadOverviewList('paid-today', { now }),
      loadOverviewList('funnel-signed-up', { now, days: 7 }),
      loadSignupFunnel(nowMs),
      loadPaidSignupMembers(),
      directoryCounts(),
    ])
    const builtDays = new Map<string, InsightsDay>()
    const dayOf = async (d: string) => {
      if (!builtDays.has(d)) builtDays.set(d, await buildInsightsDay(admin, d, nowMs))
      return builtDays.get(d)!
    }

    // All time: the cards' "Total" bottom line = the People tabs.
    const allTime: CountSource[] = [
      { screen: 'People tabs (all time)', values: { tutor_signups: dirCounts.tutors, parent_signups: dirCounts.parents } },
      { screen: 'Overview card Total', values: { tutor_signups: num(tutorsCard.card?.bottom?.value), parent_signups: num(parentsCard.card?.bottom?.value) } },
    ]
    const allBad = compareSources(allTime)
    console.log(`\nAll time  People tutors ${dirCounts.tutors} / card ${num(tutorsCard.card?.bottom?.value)} · parents ${dirCounts.parents} / card ${num(parentsCard.card?.bottom?.value)}  ${allBad.length ? 'MISMATCH' : 'MATCH'}`)
    failed += allBad.length

    for (const period of COUNT_PERIODS) {
      const span = countSpan(period.key, nowMs)
      const days = spanDays(span)
      const ref = await countsFor(span)
      const fresh = mergePeriod(days[0], days[days.length - 1], await Promise.all(days.map(dayOf)))
      const stored = await loadInsightsPeriod(days[0], days[days.length - 1], { nowMs, buildMissing: 0 })

      const card = (k: 'today' | 'yesterday' | 'last7') => ({
        tutor_signups: num(tutorsCard.card?.[k]),
        parent_signups: num(parentsCard.card?.[k]),
        tuitions_posted: num(tuitionsCard.card?.[k]),
        paid_fee: num(paidCard.card?.[k]),
      })
      const sources: CountSource[] = [{ screen: 'lib/counts', values: ref }]
      if (period.key !== 'month') sources.push({ screen: 'Overview cards', values: card(period.key) })
      else sources.push({ screen: 'Overview Paid "This month"', values: { paid_fee: num(paidCard.card?.bottom?.value) } })
      if (period.key === 'last7') sources.push({ screen: 'Overview Signup to payment (7 days)', values: { tutor_signups: funnel7.rows.length } })

      const insightValues = (p: typeof fresh): Partial<Record<CountKey, number>> => {
        const v: Partial<Record<CountKey, number>> = {}
        for (const [action, key] of Object.entries(SHARED_ACTION_COUNT)) v[key as CountKey] = p.actions[action as ActionKey]
        return v
      }
      sources.push({ screen: 'Insights actions', values: insightValues(fresh) })
      sources.push({ screen: 'Insights Active users', values: { signups: fresh.totals.newSignups, tutor_signups: fresh.totals.newTutors, parent_signups: fresh.totals.newParents } })
      sources.push({ screen: 'Insights funnels', values: { tutor_signups: fresh.funnelTutor[0]?.count ?? 0, parent_signups: fresh.funnelParent[0]?.count ?? 0 } })

      if (period.key === 'last7') {
        const drill: Partial<Record<CountKey, number>> = {}
        for (const [action, key] of Object.entries(SHARED_ACTION_COUNT)) {
          const m = await insightMembers(action as ActionKey, days[0], days[days.length - 1])
          drill[key as CountKey] = m.reduce((n, x) => n + x.count, 0)
        }
        sources.push({ screen: 'Insights drill-down lists', values: drill })
      }

      const fw = daily.find((w) => w.key === period.key)
      if (fw) {
        const step = (k: string) => fw.steps.find((s) => s.key === k)?.count ?? 0
        sources.push({ screen: 'Daily sign-up funnel', values: { tutor_mobile_verified: step('mobile'), tutor_onboarded: step('onboarded'), paid_fee: step('paid') } })
      }
      sources.push({ screen: 'Paid sign-ups', values: { paid_fee: paidMembers.rows.filter((r) => { const t = Date.parse(r.at); return t >= span.start && t < span.end }).length } })

      const bad = compareSources(sources)
      failed += bad.length
      console.log(`\n=== ${period.label} (${days[0]} → ${days[days.length - 1]}, Pakistan time) — ${bad.length ? `${bad.length} MISMATCH` : 'MATCH'}`)
      for (const key of COUNT_KEYS) {
        const vals = sources.filter((s) => s.values[key] !== undefined).map((s) => `${s.screen} ${s.values[key]}`)
        const flag = bad.some((b) => b.key === key) ? '  ✗' : ''
        console.log(`  ${COUNT_DEFS[key].label.padEnd(28)} ${vals.join(' · ')}${flag}`)
      }
      // The stored Insights days (cache) — reported, never a failure.
      const storedDiff = compareSources([{ screen: 'fresh', values: insightValues(fresh) }, { screen: 'stored', values: insightValues(stored) }])
      console.log(`  stored Insights days: ${stored.builtDays}/${stored.totalDays} at the current version · ${storedDiff.length === 0 ? 'same as fresh' : `${storedDiff.length} count(s) still being rebuilt: ${storedDiff.map((d) => `${COUNT_DEFS[d.key].label} stored ${d.values[1]?.value} vs ${d.values[0]?.value}`).join('; ')}`}`)
    }
  })
  console.log(failed ? `\nFAIL — ${failed} count(s) disagree between screens.` : '\nPASS — every shared count is the same on every screen.')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
