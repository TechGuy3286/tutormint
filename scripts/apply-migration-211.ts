/**
 * scripts/apply-migration-211.ts — applies supabase/migrations/211_fee_match_refund_due_parent_templates.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks the result. Prints counts and keys only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-211.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/211_fee_match_refund_due_parent_templates.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const one = async (q: string) => (await c.query(q)).rows[0]
  try {
    const before = {
      payments: (await one(`select count(*)::int n from payments`)).n,
      credits: (await one(`select count(*)::int n from bank_transfers`)).n,
    }
    await c.query(sql)
    await c.query(sql)
    const checks = {
      feeMin: (await one(`select value from app_settings where key = 'pay.fee_match_min'`))?.value ?? null,
      feeMax: (await one(`select value from app_settings where key = 'pay.fee_match_max'`))?.value ?? null,
      roundingCol: (await one(`select count(*)::int n from information_schema.columns where table_name='payments' and column_name='rounding_pkr'`)).n,
      categoryCol: (await one(`select count(*)::int n from information_schema.columns where table_name='bank_transfers' and column_name='category'`)).n,
      refundTable: (await one(`select count(*)::int n from pg_tables where schemaname='public' and tablename='refund_dues' and rowsecurity`)).n,
      refundPolicies: (await one(`select count(*)::int n from pg_policies where tablename='refund_dues'`)).n,
      tutorsApplied: (await one(`select count(*)::int n from admin_message_templates where key='pf_tutors_applied'`)).n,
      signinLink: (await one(`select count(*)::int n from admin_message_templates where key='pf_email_unconfirmed' and body like '%{signin_link}%'`)).n,
      repostLink: (await one(`select count(*)::int n from admin_message_templates where key='pf_expired' and body like '%{repost_link}%'`)).n,
      payments: (await one(`select count(*)::int n from payments`)).n,
      credits: (await one(`select count(*)::int n from bank_transfers`)).n,
      categorised: (await one(`select count(*)::int n from bank_transfers where category is not null`)).n,
    }
    console.log('after (ran twice):', JSON.stringify(checks))
    if (checks.roundingCol !== 1 || checks.categoryCol !== 1 || checks.refundTable !== 1) throw new Error('columns or table missing')
    if (checks.refundPolicies !== 1) throw new Error('refund_dues must have exactly the admin read policy')
    if (checks.payments !== before.payments || checks.credits !== before.credits || checks.categorised !== 0) throw new Error('rows changed')
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
