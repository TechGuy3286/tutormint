/**
 * scripts/report-jobs-readers.ts — READ-ONLY. Every SQL function and view that
 * reads public.jobs (with its security mode), the jobs policies, and the
 * staff_signup_credits columns. Writes the definitions to the folder given.
 *   npx tsx --env-file=.env.local scripts/report-jobs-readers.ts <outDir>
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('pass an output folder')
  mkdirSync(out, { recursive: true })
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const f = await c.query(`
    select p.proname, p.prosecdef, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* '\\mjobs\\M'`)
  for (const r of f.rows) {
    console.log(`function ${r.proname} definer=${r.prosecdef}`)
    writeFileSync(join(out, `fn_${r.proname}.sql`), r.def)
  }
  const v = await c.query(`
    select c.relname, c.reloptions, pg_get_viewdef(c.oid) as def from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('v','m') and pg_get_viewdef(c.oid) ~* '\\mjobs\\M'`)
  for (const r of v.rows) {
    console.log(`view ${r.relname} ${JSON.stringify(r.reloptions)}`)
    writeFileSync(join(out, `view_${r.relname}.sql`), r.def)
  }
  const pol = await c.query(`select policyname, cmd, roles, qual, with_check from pg_policies where tablename='jobs'`)
  console.table(pol.rows)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
