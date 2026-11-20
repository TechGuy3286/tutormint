/**
 * scripts/report-insights-day.ts — PR-12. READ-ONLY: builds one Admin → Insights
 * day (default yesterday, PKT) without storing it and prints counts only (no ids,
 * names or numbers). Times the build.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-insights-day.ts [YYYY-MM-DD]
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { buildInsightsDay } from '@/lib/insights'
import { pkDayOf } from '@/lib/insightsCore'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('no admin client')
  const day = process.argv[2] ?? pkDayOf(Date.now() - 86_400_000)
  const t0 = Date.now()
  const d = await buildInsightsDay(admin, day)
  console.log(`day ${day} built in ${Date.now() - t0} ms`)
  console.log('active tutors', d.tutorsActive.length, '· parents', d.parentsActive.length, '· visitors', d.visitors, '· new tutors', d.newTutors.length, '· new parents', d.newParents.length)
  console.log('actions', JSON.stringify(d.actions))
  console.log('searches kept', d.searches.length, '· zero-result', d.searches.filter((s) => s.zero > 0).length)
  console.log('hours', d.hours.join(' '))
  console.log('device', JSON.stringify(d.device))
  console.log('funnel tutor', d.funnelTutor.join(' → '), '· parent', d.funnelParent.join(' → '))
  console.log('payload bytes', JSON.stringify(d).length)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
