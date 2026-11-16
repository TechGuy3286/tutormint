// Read-only: the last blog.generate audit rows (model, outcome, reason). No text, no people.
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
const { Client } = pg
async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const r = await c.query(
    `select created_at, detail->>'model' model, detail->>'source' source, detail->>'reason' reason,
            detail->>'noteChars' notes, detail->'availableModels' models
       from admin_audit_log where action in ('blog.generate','blog.draft_from_queue')
      order by created_at desc limit 15`,
  )
  for (const row of r.rows) console.log(JSON.stringify(row))
  await c.end()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
