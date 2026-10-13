/**
 * scripts/apply-migration-170.ts — applies
 * supabase/migrations/170_partner_edit_areas_one_off_emails.sql (write policies
 * for the Partner role, and the one_off_emails table; no existing row changes).
 * One transaction; without --apply it rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-170.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/170_partner_edit_areas_one_off_emails.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const policies = async () =>
    (
      await c.query(`select schemaname || '.' || tablename || ':' || policyname || ':' || cmd as k,
          case when (coalesce(qual,'') || coalesce(with_check,'')) like '%is_admin_full_writer()%' then 'full'
               when (coalesce(qual,'') || coalesce(with_check,'')) like '%is_admin_writer()%' then 'writer'
               when (coalesce(qual,'') || coalesce(with_check,'')) like '%partner%' then 'not-partner'
               else 'other' end as gate
        from pg_policies where schemaname in ('public','storage') and cmd <> 'SELECT' order by 1`)
    ).rows as { k: string; gate: string }[]
  const selects = async () =>
    (await c.query(`select md5(string_agg(schemaname || tablename || policyname || coalesce(qual,''), '|' order by schemaname, tablename, policyname)) as fp, count(*)::int as n from pg_policies where cmd = 'SELECT'`)).rows[0]
  const before = await policies()
  const selBefore = await selects()
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await policies()
    const selAfter = await selects()
    console.log('write policies before/after:', before.length, after.length)
    const b = new Map(before.map((r) => [r.k, r.gate]))
    for (const r of after) if (b.get(r.k) !== r.gate) console.log(`  ${r.k}: ${b.get(r.k) ?? '(new)'} -> ${r.gate}`)
    console.log('still open to a Partner (writer):', after.filter((r) => r.gate === 'writer').map((r) => r.k.split(':')[0].replace('public.', '')).join(', '))
    // The new table adds exactly one SELECT policy; every other read policy is untouched.
    console.log('read policies before/after:', selBefore.n, selAfter.n)
    if (before.length !== after.length) throw new Error('a write policy was lost or added')
    if (selAfter.n !== selBefore.n + (selBefore.n === selAfter.n ? 0 : 1)) throw new Error('unexpected read policy change')
    const t = await c.query(`select count(*)::int as n from one_off_emails`)
    console.log('one_off_emails rows:', t.rows[0].n)
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
