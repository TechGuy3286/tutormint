/**
 * scripts/report-hidden-cnic-sides.ts — READ-ONLY.
 * Every member (tutor and parent) with a CNIC side that is HIDDEN
 * (user_documents.status='paused') while NO visible (active) upload of that same
 * side exists. A side is the document label: 'back', otherwise 'front'
 * (a null label has always meant front).
 *   npx tsx --env-file=.env.local scripts/report-hidden-cnic-sides.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

export const HIDDEN_SIDES_SQL = `
  select p.id as user_id, p.full_name, p.role, d.side, d.id as doc_id, d.created_at::text as uploaded_at
  from (select ud.*, case when ud.label = 'back' then 'back' else 'front' end as side
          from user_documents ud where ud.kind = 'cnic') d
  join profiles p on p.id = d.user_id
  where d.status = 'paused'
    and not exists (
      select 1 from user_documents a
       where a.user_id = d.user_id and a.kind = 'cnic' and a.status = 'active'
         and (case when a.label = 'back' then 'back' else 'front' end) = d.side)
  order by p.full_name, d.side, d.created_at desc`

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(HIDDEN_SIDES_SQL)
  const members = new Set<string>()
  const sides = new Set<string>()
  for (const r of rows) {
    members.add(r.user_id)
    sides.add(`${r.user_id}:${r.side}`)
    console.log(`${r.full_name ?? '(no name)'} | ${r.role} | ${r.side} | uploaded ${r.uploaded_at}`)
  }
  console.log(`hidden uploads: ${rows.length} · members: ${members.size} · sides with no visible upload: ${sides.size}`)
  await c.end()
}
main()
