/**
 * scripts/print-cover-prompts.ts — READ-ONLY. Prints the cover scene prompt for
 * every published post, built by the same rule the editor uses
 * (lib/covers/prompt coverImagePrompt), so the wording can be reviewed.
 *   npx tsx --env-file=.env.local scripts/print-cover-prompts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { coverImagePrompt } from '../lib/covers/prompt'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`select slug, title, cluster, city, subject, audience from posts where status = 'published' order by published_at`)
  for (const p of rows) {
    console.log(`\n/blog/${p.slug}\n${coverImagePrompt({ title: p.title, cluster: p.cluster, city: p.city, subject: p.subject, audience: p.audience, slug: p.slug })}`)
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
