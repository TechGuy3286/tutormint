/**
 * scripts/report-pr11.ts — PR-11 figures, read-only, production. COUNTS and
 * timings only — never a name, number, fingerprint or key.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-pr11.ts
 */
import { createAdminClient } from '../lib/supabase/admin'
import { loadCrawlSetUncached } from '../lib/tutorCrawl'
import { cityTutorPageIndexable, femaleTutorPageIndexable } from '../lib/tutorCrawlCore'
import { loadInterestInboxFresh, INBOX_SNAPSHOT_KEY } from '../lib/interestInbox'
import { FINGERPRINT_ENV } from '../lib/eraseFingerprintCore'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('service role unavailable')

  // 1. Erase / fingerprints.
  console.log(`${FINGERPRINT_ENV} set in this environment: ${process.env[FINGERPRINT_ENV] ? 'yes' : 'no'}`)
  const { count: erased } = await admin.from('profiles').select('id', { count: 'exact', head: true }).not('erased_at', 'is', null)
  const { count: fpMembers } = await admin.from('erased_fingerprints').select('member_id', { count: 'exact', head: true })
  const { data: sched } = await admin.from('account_erasures').select('due_at').eq('status', 'scheduled')
  const now = Date.now()
  const due = (sched ?? []).map((r) => Date.parse(r.due_at as string))
  console.log(`erased accounts: ${erased ?? 0} · fingerprint rows: ${fpMembers ?? 0} · erasures still scheduled: ${due.length} (due within 24 h: ${due.filter((t) => t - now < 86_400_000).length}, within 7 days: ${due.filter((t) => t - now < 7 * 86_400_000).length})`)
  const { count: attempts } = await admin.from('signup_block_attempts').select('id', { count: 'exact', head: true })
  console.log(`blocked sign-up attempts so far: ${attempts ?? 0}`)

  // 2. Crawl.
  const set = await loadCrawlSetUncached()
  const cityPages = set.cities.filter(cityTutorPageIndexable)
  const femalePages = set.cities.filter(femaleTutorPageIndexable)
  const linked = set.tutors.filter((t) => cityPages.some((c) => c.citySlug === t.citySlug)).length
  console.log(`indexable tutors (tutor sitemap): ${set.tutors.length}`)
  console.log(`cities with indexable tutors: ${set.cities.length} · indexable city tutor pages: ${cityPages.length} · female variants: ${femalePages.length}`)
  console.log(`indexable tutors listed on an indexable city page: ${linked} of ${set.tutors.length}`)
  console.log(`cities: ${cityPages.map((c) => `${c.city} ${c.indexable}${femaleTutorPageIndexable(c) ? ` (F ${c.female})` : ''}`).join(' · ')}`)

  // 3. Inbox.
  const t0 = Date.now()
  const fresh = await loadInterestInboxFresh()
  const buildMs = Date.now() - t0
  const t1 = Date.now()
  const { data: row } = await admin.from('admin_summary').select('payload, computed_at').eq('key', INBOX_SNAPSHOT_KEY).maybeSingle()
  const readMs = Date.now() - t1
  const stored = (row?.payload as { inbox?: { rows: unknown[]; counts: unknown } } | null)?.inbox ?? null
  console.log(`inbox: fresh build ${buildMs} ms (${fresh.rows.length} rows) · stored copy read ${readMs} ms (${stored ? `${stored.rows.length} rows, built ${row?.computed_at}` : 'none yet'})`)
  if (stored) console.log(`stored counts identical to a fresh build: ${JSON.stringify(stored.counts) === JSON.stringify(fresh.counts) ? 'yes' : 'no (built at a different moment)'}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(String((e as Error).message ?? e))
    process.exit(1)
  },
)
