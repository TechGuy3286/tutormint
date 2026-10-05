/**
 * scripts/dataop-dedupe-city.ts
 *
 * DATA-OP (owner, 5 Oct 2026, item 7): stored tuition titles and descriptions
 * that repeat the city — "Bahria Town Lahore, Lahore" — become the de-duplicated
 * text ("Bahria Town, Lahore"). The pattern is "<City>, <City>" for EVERY city in
 * location_cities (case-insensitive, whole words). Slugs and URLs are untouched
 * (public_slug is a separate column and is never read here).
 *
 *   npx tsx --env-file=.env.local scripts/dataop-dedupe-city.ts            # STEP 1: SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-dedupe-city.ts --apply    # STEP 2: update those rows, re-SELECT
 *
 * The update is `regexp_replace(col, '\m<City>, <City>\M', '<City>', 'gi')` per
 * city, applied ONLY to the ids the SELECT returned, in one transaction. Nothing
 * is deleted. The DB URL is read from env and never printed.
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set (run with: npx tsx --env-file=.env.local …)')
  process.exit(1)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function main() {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: cities } = await client.query(`select name from public.location_cities order by sort_order, name`)
    const names = (cities as { name: string }[]).map((c) => c.name)
    // One alternation over every city: (?:Lahore|Karachi|…), repeated with ", ".
    const alt = names.map(esc).join('|')
    const pattern = `\\m(${alt}),\\s*\\1\\M`

    const SELECT = `
      select id, ref_id, title, description,
             (title ~* $1) as title_hit, (coalesce(description,'') ~* $1) as description_hit
        from public.jobs
       where title ~* $1 or coalesce(description,'') ~* $1
       order by created_at`
    const before = await client.query(SELECT, [pattern])
    console.log(`Cities checked: ${names.length}`)
    console.log(`\nBEFORE — ${before.rowCount} tuition(s) with a repeated city in title or description`)
    console.table(
      (before.rows as { id: string; ref_id: string; title: string; title_hit: boolean; description_hit: boolean }[]).map((r) => ({
        id: r.id,
        ref: r.ref_id,
        title_hit: r.title_hit,
        description_hit: r.description_hit,
        title: r.title.length > 70 ? r.title.slice(0, 67) + '…' : r.title,
      })),
    )

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to update exactly these rows.')
      return
    }
    if (before.rowCount === 0) {
      console.log('\nNothing to update.')
      return
    }

    const ids = (before.rows as { id: string }[]).map((r) => r.id)
    await client.query('begin')
    try {
      // Case-insensitive match, replaced with the city as spelled in location_cities.
      const upd = await client.query(
        `update public.jobs
            set title = regexp_replace(title, $1, '\\1', 'gi'),
                description = case when description is null then null else regexp_replace(description, $1, '\\1', 'gi') end
          where id = any($2::uuid[])`,
        [pattern, ids],
      )
      console.log(`\nUpdated ${upd.rowCount} row(s).`)
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    }

    const after = await client.query(SELECT, [pattern])
    console.log(`\nAFTER — ${after.rowCount} tuition(s) still match (expect 0)`)
    if (after.rowCount) console.table(after.rows)
    const { rows: sample } = await client.query(`select id, ref_id, title from public.jobs where id = any($1::uuid[]) order by created_at limit 8`, [ids])
    console.log('\nSample of the updated titles:')
    console.table(sample)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
