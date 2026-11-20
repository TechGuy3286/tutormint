/** PR-12 read-only: the stored rows that carry "middleman / no commission / no agent" wording, with 90 characters of context either side.
 *  npx tsx --env-file=.env.local scripts/report-pr12-wording.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const RE = /middle ?m[ae]n|commission|no agents?|without (an )?agent|agent[- ]free|koi agent|ایجنٹ|کمیشن|مڈل ?مین/gi
const SQL_PAT = String.raw`middle ?m[ae]n|commission|no agent|without (an )?agent|agent[- ]free|koi agent|ایجنٹ|کمیشن|مڈل ?مین`

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    await c.query('begin read only')
    for (const t of ['posts', 'admin_message_templates', 'content_suggestions', 'post_revisions']) {
      const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 and data_type in ('text','jsonb','character varying')`, [t])
      const pk = t === 'admin_message_templates' ? 'key' : 'id'
      const rows = await c.query(`select * from public."${t}" x where x::text ~* $1`, [SQL_PAT])
      if (t === 'post_revisions') { console.log(`post_revisions: ${rows.rows.length} rows (history — left unchanged)`); continue }
      for (const r of rows.rows) {
        for (const { column_name: col } of cols.rows) {
          const v = r[col]
          const s = typeof v === 'string' ? v : v ? JSON.stringify(v) : ''
          for (const m of s.matchAll(RE)) {
            const i = m.index ?? 0
            console.log(`${t} ${r[pk]} [${col}] …${s.slice(Math.max(0, i - 90), i + 60).replace(/\n/g, '⏎')}…`)
          }
        }
      }
    }
    console.log('posts columns:', (await c.query(`select string_agg(column_name, ', ') s from information_schema.columns where table_name='posts'`)).rows[0].s)
    console.log('post_revisions columns:', (await c.query(`select string_agg(column_name, ', ') s from information_schema.columns where table_name='post_revisions'`)).rows[0].s)
    console.log('template_history columns:', (await c.query(`select string_agg(column_name, ', ') s from information_schema.columns where table_name='template_history'`)).rows[0].s)
    await c.query('rollback')
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
