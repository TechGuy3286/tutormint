/**
 * scripts/report-tuition-slug.ts — READ-ONLY. The tuition behind a public slug:
 * TM number, status, hidden fields and the poster's flags. No contact details.
 *   npx tsx --env-file=.env.local scripts/report-tuition-slug.ts <slug>
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const slug = process.argv[2]
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const r = await c.query(
    `select j.ref_id, j.status, j.hidden_reason, j.hidden_prev_status, j.city, j.public_slug, p.full_name, p.role,
            p.is_suspended, p.hidden_from_public, p.is_test_name, p.is_banned, p.is_team_account
       from jobs j join profiles p on p.id = j.parent_id where j.public_slug = $1`,
    [slug],
  )
  console.table(r.rows)
  const s = await c.query(`select ref_id, status, public_slug from jobs where parent_id = '7b811c18-f25a-435c-bed0-b2421ca6391b' order by ref_id`)
  console.table(s.rows)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
