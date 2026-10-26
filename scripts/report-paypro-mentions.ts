/**
 * scripts/report-paypro-mentions.ts — read-only. Lists the stored message
 * templates (admin_message_templates) and published/draft posts whose text
 * mentions PayPro or JazzCash, by key / slug only, and whether the mention is
 * in an English or an Urdu line. Never prints a body.
 *   npx tsx --env-file=.env.local scripts/report-paypro-mentions.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const WORD = /paypro|jazz\s*cash/i
const URDU = /[؀-ۿ]/

function where(text: string): string[] {
  const out = new Set<string>()
  for (const line of text.split(/\n/)) if (WORD.test(line)) out.add(URDU.test(line) ? 'urdu line' : 'english line')
  return [...out]
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const t = await c.query(`select key, coalesce(subject,'') || E'\n' || coalesce(body,'') txt from admin_message_templates`)
    for (const r of t.rows) if (WORD.test(r.txt) || /جاز کیش/.test(r.txt)) console.log(`template ${r.key}: ${where(r.txt).join(', ') || 'urdu (جاز کیش)'}`)
    const p = await c.query(`select slug, status, coalesce(title,'') || E'\n' || coalesce(body,'') txt from posts`)
    for (const r of p.rows) if (WORD.test(r.txt)) console.log(`post ${r.slug} (${r.status}): ${where(r.txt).join(', ')}`)
    console.log('done')
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
