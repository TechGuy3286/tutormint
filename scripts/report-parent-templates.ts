/**
 * scripts/report-parent-templates.ts — READ ONLY (owner, 9 Nov 2026).
 * Lists the live parent-facing WhatsApp / email wordings that suggest our team
 * posts the tuition for the parent ("tell us …", "we will post"), plus the
 * review state of pf_no_tuition. Prints template keys and the matched words
 * only — never a member detail.
 *   npx tsx --env-file=.env.local scripts/report-parent-templates.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const HINTS = /tell us|we will post|we'll post|we post|send us|share (the )?(details|class)|our team will post/i

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const t = await c.query(`select key, title, body, active, retired_at from admin_message_templates order by key`)
    for (const r of t.rows) {
      const m = String(r.body ?? '').match(HINTS)
      if (m) console.log(`template ${r.key}${r.retired_at ? ' (retired)' : ''}${r.active === false ? ' (inactive)' : ''}: "${m[0]}"`)
    }
    const e = await c.query(`select variant, subject, body from email_wordings order by variant`).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    for (const r of e.rows) {
      const m = `${r.subject ?? ''} ${r.body ?? ''}`.match(HINTS)
      if (m) console.log(`email ${r.variant}: "${m[0]}"`)
    }
    const rv = await c.query(`select key, status from template_reviews where key = 'pf_no_tuition'`).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    console.log('pf_no_tuition review:', rv.rows[0]?.status ?? 'not reviewed')
    const live = await c.query(`select length(body) n from admin_message_templates where key = 'pf_no_tuition'`)
    console.log('pf_no_tuition live length:', live.rows[0]?.n ?? 'missing')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
