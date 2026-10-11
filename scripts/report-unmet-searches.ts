/**
 * scripts/report-unmet-searches.ts — READ ONLY. How many "Unmet searches this
 * week" cards remain once staff, test-account and test-text searches are left
 * out and identical searches are merged (the rule of lib/unmetSearchCore).
 *   npx tsx --env-file=.env.local scripts/report-unmet-searches.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { buildUnmet, excludeReason, type UnmetRow } from '../lib/unmetSearchCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    `select id::int, query, surface, city, subject, level, school, role, is_test, created_at from search_unmet where created_at >= now() - interval '7 days' order by id`,
  )
  const { rows: done } = await c.query(`select query_key, done_at from search_unmet_done`)
  await c.end()
  const list = rows.map((r: Record<string, unknown>) => ({ ...r, created_at: new Date(r.created_at as string).toISOString() })) as UnmetRow[]
  const board = buildUnmet(list, done.map((d: { query_key: string; done_at: Date }) => ({ query_key: d.query_key, done_at: new Date(d.done_at).toISOString() })))
  const reasons: Record<string, number> = {}
  for (const r of list) {
    const why = excludeReason(r)
    if (why) reasons[why] = (reasons[why] ?? 0) + 1
  }
  console.log(`searches in the last 7 days: ${list.length}`)
  console.log(`left out: ${board.excluded}`, JSON.stringify(reasons))
  console.log(`cards to review: ${board.toReview.length}`)
  for (const k of board.toReview) console.log(`  ${k.count}x  [${k.surfaces.join('+')}] [${k.roles.join(',')}]  city=${k.city ?? '-'} subject=${k.subject ?? '-'} level=${k.level ?? '-'} school=${k.school ?? '-'}  "${k.query}"`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
