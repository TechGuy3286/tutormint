/**
 * scripts/report-saved-cover-prompts.ts — READ-ONLY. How many posts have a
 * saved cover prompt, and how many of those still carry a hex code. Saved text
 * is never rewritten (owner, 14 Oct 2026); this only counts.
 *   npx tsx --env-file=.env.local scripts/report-saved-cover-prompts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    `select count(*) filter (where cover_prompt is not null)::int as saved,
            count(*) filter (where cover_prompt ~* '#[0-9a-f]{3,8}')::int as with_hex
       from posts`,
  )
  console.log(JSON.stringify(rows[0]))
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
