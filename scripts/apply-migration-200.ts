/**
 * scripts/apply-migration-200.ts — applies supabase/migrations/200_paypro_retire_bank_reader.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - payments and bank_transfers rows are byte-identical before and after;
 *   - the cut-off setting reads a YYYY-MM-DD day; pay.raast_id exists;
 *   - bank_reader_state has one row, switched OFF;
 *   - finance_alerts and bank_reader_state refuse a signed-in token's insert
 *     (no write policy), proved in a rolled-back savepoint;
 *   - bank_transfers accepts source 'email' and refuses an unknown channel.
 * Prints counts only — never a setting value other than the cut-off day.
 *   npx tsx --env-file=.env.local scripts/apply-migration-200.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/200_paypro_retire_bank_reader.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fpPay = `select count(*)::int n, md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by t.id), '')) m from payments t`
    const fpBank = `select count(*)::int n, md5(coalesce(string_agg((to_jsonb(t) - 'channel' - 'message_id')::text, ',' order by t.id), '')) m from bank_transfers t`
    const p0 = (await c.query(fpPay)).rows[0]
    const b0 = (await c.query(fpBank)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const p1 = (await c.query(fpPay)).rows[0]
    const b1 = (await c.query(fpBank)).rows[0]
    if (p0.m !== p1.m) throw new Error('a payments row changed')
    if (b0.m !== b1.m) throw new Error('a bank_transfers row changed')

    const cutoff = (await c.query(`select value from app_settings where key = 'pay.paypro.cutoff'`)).rows[0]?.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cutoff ?? ''))) throw new Error('cut-off setting missing')
    const raast = (await c.query(`select count(*)::int n from app_settings where key = 'pay.raast_id'`)).rows[0].n
    if (raast !== 1) throw new Error('pay.raast_id missing')
    const st = (await c.query(`select count(*)::int n, bool_or(enabled) on_ from bank_reader_state`)).rows[0]
    if (st.n !== 1 || st.on_) throw new Error('bank_reader_state must be one row, OFF')

    // A signed-in token cannot write either table.
    for (const t of ['finance_alerts', 'bank_reader_state']) {
      await c.query('savepoint s')
      await c.query(`set local role authenticated`)
      let refused = false
      try {
        if (t === 'finance_alerts') await c.query(`insert into finance_alerts (kind, ref, title) values ('reader_failing', 'probe', 'probe')`)
        else await c.query(`update bank_reader_state set enabled = true`)
        const n = t === 'bank_reader_state' ? (await c.query(`select count(*)::int n from bank_reader_state where enabled`)).rows[0].n : 1
        if (t === 'bank_reader_state' && n === 0) refused = true
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint s')
      if (!refused) throw new Error(`${t} accepted a signed-in write`)
    }

    await c.query('savepoint s2')
    let badChannel = false
    try {
      await c.query(`insert into bank_transfers (transferred_on, amount_pkr, reference, source, gateway, channel) values (current_date, 1, 'PROBE-200', 'email', 'manual', 'cash')`)
    } catch {
      badChannel = true
    }
    await c.query('rollback to savepoint s2')
    if (!badChannel) throw new Error('unknown channel accepted')
    await c.query('savepoint s3')
    await c.query(`insert into bank_transfers (transferred_on, amount_pkr, reference, source, gateway, channel, message_id) values (current_date, 1, 'PROBE-200', 'email', 'manual', 'raast', '<probe@test>')`)
    await c.query('rollback to savepoint s3')

    console.log(`payments ${p1.n} unchanged; bank_transfers ${b1.n} unchanged; cut-off ${cutoff}; reader OFF; RLS refuses signed-in writes`)
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
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
