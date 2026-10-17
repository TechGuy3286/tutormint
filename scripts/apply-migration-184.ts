/**
 * scripts/apply-migration-184.ts — applies supabase/migrations/184_three_more_cities.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks the city count is 26 and every existing city is unchanged.
 *   npx tsx --env-file=.env.local scripts/apply-migration-184.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/184_three_more_cities.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const before = (await c.query('select id, name, sort_order from location_cities order by id')).rows
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query('select id, name, sort_order from location_cities order by id')).rows
    for (const b of before) {
      const a = after.find((r: { id: number }) => r.id === b.id)
      if (!a || a.name !== b.name || a.sort_order !== b.sort_order) throw new Error(`existing city changed: ${b.name}`)
    }
    const names = after.map((r: { name: string }) => r.name)
    for (const n of ['Sheikhupura', 'Jhang', 'Rahim Yar Khan']) if (!names.includes(n)) throw new Error(`missing ${n}`)
    console.log(`cities before ${before.length}, after ${after.length}`)
    if (after.length !== 26) throw new Error('expected 26 cities')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
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
