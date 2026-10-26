// READ-ONLY: writes tutor_public_page()'s live definition to a file (owner, 27 Oct 2026).
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { writeFileSync } from 'node:fs'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const r = await c.query(`select pg_get_functiondef('public.tutor_public_page(text)'::regprocedure) d`)
  writeFileSync(process.argv[2], r.rows[0].d)
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
