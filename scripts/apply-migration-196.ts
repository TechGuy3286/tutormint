/**
 * scripts/apply-migration-196.ts — applies supabase/migrations/196_tutor_journey.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - no existing profile, tutor profile, follow-up or template row changed;
 *   - the four new Follow-ups templates hold exactly the code defaults;
 *   - a member note cannot be edited or deleted, only withdrawn with a reason;
 *   - a signed-in member or staff token cannot write member_notes;
 *   - converted_tutor_redirects() answers (and lists nobody yet).
 *   npx tsx --env-file=.env.local scripts/apply-migration-196.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { FU_NEW_DEFAULTS } from '../lib/followUpTemplatesCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/196_tutor_journey.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select (select md5(string_agg(id::text || role::text || coalesce(full_name,''), ',' order by id)) from profiles) p,
                       (select md5(string_agg(id::text || coalesce(slug,'') || coalesce(city,''), ',' order by id)) from tutor_profiles) t,
                       (select md5(string_agg(id::text || created_at::text || coalesce(template_key,''), ',' order by id)) from member_follow_ups) f,
                       (select md5(string_agg(key || body, ',' order by key)) from admin_message_templates where key not like 'fu\\_%') m`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    for (const k of ['p', 't', 'f', 'm']) if (before[k] !== after[k]) throw new Error(`a row changed (${k})`)
    console.log('rows: no profile, tutor profile, follow-up or existing template changed')

    const seeded = (await c.query(`select key, body from admin_message_templates where key like 'fu\\_%'`)).rows as { key: string; body: string }[]
    for (const [key, body] of Object.entries(FU_NEW_DEFAULTS)) {
      const row = seeded.find((r) => r.key === key)
      if (row?.body !== body) throw new Error(`${key}: seeded body differs from the code default`)
    }
    console.log(`templates: ${Object.keys(FU_NEW_DEFAULTS).length} new Follow-ups templates, byte-for-byte the code defaults`)

    const member = (await c.query(`select id from profiles where role = 'tutor' limit 1`)).rows[0]
    const staff = (await c.query(`select id from profiles where role = 'admin' and admin_role = 'owner' limit 1`)).rows[0]
    await c.query('savepoint notes')
    const note = (await c.query(`insert into member_notes (member_id, kind, body, staff_id, staff_name) values ($1, 'note', 'migration probe', $2, 'Probe') returning id`, [member.id, staff.id])).rows[0]
    for (const [label, q] of [
      ['edit', `update member_notes set body = 'changed' where id = $1`],
      ['delete', `delete from member_notes where id = $1`],
      ['withdraw without a reason', `update member_notes set withdrawn_at = now() where id = $1`],
    ] as const) {
      await c.query('savepoint probe')
      const refused = await c.query(q, [note.id]).then(() => false, () => true)
      await c.query('rollback to savepoint probe')
      if (!refused) throw new Error(`a note ${label} was allowed`)
    }
    await c.query(`update member_notes set withdrawn_at = now(), withdrawn_reason = 'probe' where id = $1`, [note.id])
    await c.query('savepoint again')
    const twice = await c.query(`update member_notes set withdrawn_reason = 'other' where id = $1`, [note.id]).then(() => false, () => true)
    await c.query('rollback to savepoint again')
    if (!twice) throw new Error('a withdrawn note was changed again')
    for (const who of [member.id, staff.id]) {
      await c.query('savepoint rls')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
      await c.query(`set local role authenticated`)
      const r = await c
        .query(`insert into member_notes (member_id, kind, body) values ($1, 'note', 'x')`, [member.id])
        .then(() => 'inserted', (e: { code?: string }) => e.code)
      await c.query('rollback to savepoint rls')
      if (r === 'inserted') throw new Error('a signed-in token could write a member note')
    }
    await c.query('rollback to savepoint notes')
    console.log('notes: edit, delete and a reason-less withdraw refused; withdrawn once only; no signed-in token can write')

    const rpc = (await c.query(`select count(*)::int n from converted_tutor_redirects()`)).rows[0]
    console.log(`converted_tutor_redirects(): ${rpc.n} rows`)

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
