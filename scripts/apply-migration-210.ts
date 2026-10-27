/**
 * scripts/apply-migration-210.ts — applies supabase/migrations/210_complaint_hold_email_savings.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks the result. Prints counts and names only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-210.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/210_complaint_hold_email_savings.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const one = async (q: string) => (await c.query(q)).rows[0]
  try {
    const hiddenBefore = (await one(`select count(*)::int n from jobs where status = 'hidden'`)).n
    const redirectsBefore = (await one(`select count(*)::int n from hidden_tuition_redirects()`)).n
    await c.query(sql)
    await c.query(sql)
    const checks = {
      consentAskActive: (await one(`select active from admin_message_templates where key = 'consent_ask'`))?.active ?? null,
      inactiveTemplates: (await one(`select count(*)::int n from admin_message_templates where not active`)).n,
      holdTables: (await one(`select count(*)::int n from pg_tables where schemaname='public' and tablename in ('contact_holds','contact_hold_jobs','email_do_not_send','email_queue')`)).n,
      rlsOn: (await one(`select count(*)::int n from pg_tables where schemaname='public' and tablename in ('contact_holds','contact_hold_jobs','email_do_not_send','email_queue') and rowsecurity`)).n,
      holdPolicies: (await one(`select count(*)::int n from pg_policies where tablename in ('contact_holds','contact_hold_jobs')`)).n,
      dailyLimit: (await one(`select value from app_settings where key = 'email.daily_limit'`))?.value ?? null,
      hiddenAfter: (await one(`select count(*)::int n from jobs where status = 'hidden'`)).n,
      redirectsAfter: (await one(`select count(*)::int n from hidden_tuition_redirects()`)).n,
    }
    // The queued status is accepted (inside this transaction, then undone).
    await c.query('savepoint q')
    await c.query(`insert into email_sends (mode, job, template, recipient, status) values ('one', 'migration-210-probe', 'probe', 'probe@example.invalid', 'queued')`)
    await c.query('rollback to savepoint q')
    console.log(`before: hidden ${hiddenBefore} · redirects ${redirectsBefore}`)
    console.log('after (ran twice):', JSON.stringify(checks))
    if (checks.consentAskActive !== false) throw new Error('consent_ask is not inactive')
    if (checks.holdTables !== 4 || checks.rlsOn !== 4) throw new Error('tables or RLS missing')
    if (checks.holdPolicies !== 0) throw new Error('hold tables must have no policies')
    if (checks.hiddenAfter !== hiddenBefore || checks.redirectsAfter !== redirectsBefore) throw new Error('hidden tuitions changed')
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
