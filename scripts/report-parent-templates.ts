/**
 * scripts/report-parent-templates.ts — READ ONLY (owner, 31 Oct 2026).
 * Lists every stored template a parent can receive and checks the text: no old
 * generic "Do you need any help finding a tutor" line, and each situation (pf_*)
 * template carries a link placeholder. Prints keys and yes/no only.
 *
 *   npx tsx --env-file=.env.local scripts/report-parent-templates.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const { rows } = await c.query(`select key, body, retired_at is not null as retired from admin_message_templates order by key`)
    let generic = 0
    for (const r of rows as { key: string; body: string | null; retired: boolean }[]) {
      const body = r.body ?? ''
      const isGeneric = /finding a tutor\?|Do you need any help\?/i.test(body)
      if (isGeneric) generic++
      if (r.key.startsWith('pf_') || isGeneric) {
        const link = /\{(post_link|tuition_link|tutor_links|signin_link|repost_link|review_link|link)\}/.test(body)
        console.log(`${r.key}: link=${link ? 'yes' : 'NO'} generic=${isGeneric ? 'YES' : 'no'} retired=${r.retired ? 'yes' : 'no'}`)
      }
    }
    console.log('templates with generic text:', generic)
    await c.query('rollback')
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
