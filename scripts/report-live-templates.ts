// scripts/report-live-templates.ts — READ ONLY. Dumps every admin message
// template (key, active, title, subject, body) as JSON to the path given, so
// the proposed wording can be written against the live text. Templates hold
// no member data.
//
//   npx tsx --env-file=.env.local scripts/report-live-templates.ts <out.json>

// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { writeFileSync } from 'node:fs'

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('Give an output path.')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query('select * from admin_message_templates order by key')
  writeFileSync(out, JSON.stringify(rows, null, 2))
  console.log(`templates: ${rows.length} → ${out}`)
  await c.end()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
