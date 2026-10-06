/**
 * scripts/dataop-dismiss-template-suggestions.ts — one-time data operation
 * (owner, 6 Oct 2026): mark the current TEMPLATED content-queue suggestions —
 * the "[X] tutors in <City>: fees and how to choose" / ": a complete guide"
 * variants — as DISMISSED with the reason "template variant". Nothing is
 * deleted; a dismissed row keeps the dedupe rule blocking its variants (see
 * lib/contentQueue/mix dedupeTitles).
 *
 *   npx tsx --env-file=.env.local scripts/dataop-dismiss-template-suggestions.ts            # SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-dismiss-template-suggestions.ts --apply    # update
 */

import { Client } from 'pg'

const TEMPLATE_RE = String.raw`tutors in .+: (fees and how to choose|a complete guide)$`

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const sel = await c.query(
    `select id, status, source, title from content_suggestions
      where card = 'content' and status in ('suggested', 'snoozed') and title ~* $1
      order by priority desc`,
    [TEMPLATE_RE],
  )
  console.log(`Templated open suggestions: ${sel.rowCount}`)
  for (const r of sel.rows) console.log(`  ${String(r.status).padEnd(9)} ${String(r.source).padEnd(11)} ${r.title}`)

  if (!apply) {
    console.log('\nSELECT only. Re-run with --apply to dismiss them (reason: template variant).')
    await c.end()
    return
  }

  await c.query('begin')
  const upd = await c.query(
    `update content_suggestions
        set status = 'dismissed', dismiss_reason = 'template variant', updated_at = now()
      where card = 'content' and status in ('suggested', 'snoozed') and title ~* $1`,
    [TEMPLATE_RE],
  )
  await c.query('commit')
  console.log(`\nDismissed: ${upd.rowCount}`)

  const again = await c.query(
    `select count(*)::int as n from content_suggestions where card = 'content' and status in ('suggested', 'snoozed') and title ~* $1`,
    [TEMPLATE_RE],
  )
  console.log(`Templated open suggestions after: ${again.rows[0].n}`)
  const dismissed = await c.query(`select count(*)::int as n from content_suggestions where status = 'dismissed' and dismiss_reason = 'template variant'`)
  console.log(`Rows dismissed as "template variant": ${dismissed.rows[0].n}`)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
