/**
 * scripts/dataop-remove-orphan-messages.ts
 *
 * DATA-OP (owner, 5 Oct 2026, item 9): remove the FIVE orphan messages from
 * August 2026 — messages whose sender or recipient no longer exists. An
 * explicit one-off exception to "never delete"; scoped to the ids the SELECT
 * returns and refused unless that SELECT matches exactly five rows.
 *
 * `messages` carries sender_id + thread_id (and legacy text columns `sender` /
 * `recipient` from the pre-rebuild table, which hold emails or display names,
 * not ids). The recipient is the OTHER participant on the thread
 * (threads.participant_a / participant_b). A message is an orphan when its
 * SENDER is not in auth.users, OR its thread exists and the thread's other
 * participant (the RECIPIENT) is not in auth.users. A message whose sender is
 * still a member but whose thread row is gone is NOT an orphan under "sender or
 * recipient no longer exists" — its recipient is unknown, not known-missing — so
 * it is listed for the report but left alone.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-remove-orphan-messages.ts            # STEP 1: SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-remove-orphan-messages.ts --apply    # STEP 2: delete those ids, re-SELECT
 *
 * The DB URL is read from env and never printed. Message bodies are never
 * printed (ids, dates and participant ids only).
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set (run with: npx tsx --env-file=.env.local …)')
  process.exit(1)
}
const EXPECTED = 5
const FROM = '2026-08-01T00:00:00Z'
const TO = '2026-09-01T00:00:00Z'

type Row = { id: string; created_at: string; sender_id: string | null; recipient_id: string | null; why: string }

async function main() {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: cols } = await client.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'messages'`,
    )
    const names = new Set((cols as { column_name: string }[]).map((c) => c.column_name))
    for (const need of ['id', 'created_at', 'sender_id', 'thread_id']) {
      if (!names.has(need)) throw new Error(`public.messages has no "${need}" column — stopping`)
    }
    const hasRecipient = names.has('recipient_id')
    console.log(`messages columns: ${[...names].sort().join(', ')}`)

    const recipientExpr = hasRecipient
      ? `coalesce(m.recipient_id, case when t.participant_a = m.sender_id then t.participant_b else t.participant_a end)`
      : `case when t.participant_a = m.sender_id then t.participant_b else t.participant_a end`

    const SELECT = `
      with x as (
        select m.id, m.created_at, m.sender_id, m.thread_id,
               ${recipientExpr} as recipient_id,
               t.id as thread_exists
          from public.messages m
          left join public.threads t on t.id = m.thread_id
         where m.created_at >= $1::timestamptz and m.created_at < $2::timestamptz
      )
      select x.id, x.created_at, x.sender_id, x.recipient_id,
             concat_ws(', ',
               case when x.sender_id is null or not exists (select 1 from auth.users u where u.id = x.sender_id) then 'sender missing' end,
               case when x.thread_exists is not null and (x.recipient_id is null or not exists (select 1 from auth.users u where u.id = x.recipient_id)) then 'recipient missing' end,
               case when x.thread_exists is null then '(thread row also missing)' end
             ) as why
        from x
       where (x.sender_id is null or not exists (select 1 from auth.users u where u.id = x.sender_id))
          or (x.thread_exists is not null and (x.recipient_id is null or not exists (select 1 from auth.users u where u.id = x.recipient_id)))
       order by x.created_at`

    const before = (await client.query(SELECT, [FROM, TO])).rows as Row[]
    console.log(`\nBEFORE — ${before.length} orphan message(s) dated August 2026`)
    console.table(before.map((r) => ({ id: r.id, created_at: r.created_at, sender_id: r.sender_id, recipient_id: r.recipient_id, why: r.why })))
    // For the report: August messages that are NOT orphans by this rule but have
    // no thread row (sender still a member) — listed, never touched.
    const { rows: kept } = await client.query(
      `select m.id, m.created_at, m.sender_id, m.recipient::text as recipient_legacy
         from public.messages m
        where m.created_at >= $1::timestamptz and m.created_at < $2::timestamptz
          and exists (select 1 from auth.users u where u.id = m.sender_id)
          and (m.thread_id is null or not exists (select 1 from public.threads t where t.id = m.thread_id))
        order by m.created_at`,
      [FROM, TO],
    )
    if (kept.length) {
      console.log(`\nNot orphans (sender still a member; only the thread row is missing) — left alone: ${kept.length}`)
      console.table(kept)
    }

    if (before.length !== EXPECTED) {
      console.log(`\nSTOP — expected exactly ${EXPECTED} rows, found ${before.length}. Nothing deleted.`)
      process.exitCode = 2
      return
    }
    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to delete exactly these five by id.')
      return
    }

    const ids = before.map((r) => r.id)
    await client.query('begin')
    try {
      // Dependants first, if any point at a message (reports/reply_to keep rows
      // valid otherwise).
      if (names.has('reply_to')) {
        await client.query(`update public.messages set reply_to = null where reply_to = any($1::uuid[])`, [ids])
      }
      const { rows: reg } = await client.query(
        `select 1 from information_schema.tables where table_schema = 'public' and table_name = 'message_reports'`,
      )
      if (reg.length) await client.query(`delete from public.message_reports where message_id = any($1::uuid[])`, [ids])
      const del = await client.query(`delete from public.messages where id = any($1::uuid[])`, [ids])
      if (del.rowCount !== EXPECTED) throw new Error(`deleted ${del.rowCount} rows, expected ${EXPECTED} — rolled back`)
      await client.query('commit')
      console.log(`\nDeleted ${del.rowCount} message(s) by id.`)
    } catch (e) {
      await client.query('rollback')
      throw e
    }

    const after = (await client.query(SELECT, [FROM, TO])).rows as Row[]
    console.log(`\nAFTER — ${after.length} orphan message(s) dated August 2026 remain`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
