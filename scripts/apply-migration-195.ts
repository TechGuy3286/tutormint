/**
 * scripts/apply-migration-195.ts — applies supabase/migrations/195_applications_v31.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no applications, jobs or forward row changed, that the
 * 8 Applications templates hold exactly the code defaults, that the support
 * setting exists, and that a signed-in staff or member token still cannot
 * write applicant_forwards or application_follow_ups.
 *   npx tsx --env-file=.env.local scripts/apply-migration-195.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { APP_TEMPLATES } from '../lib/applicationTemplatesCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/195_applications_v31.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select (select md5(string_agg(id::text || stage || coalesce(worked_at::text,''), ',' order by id)) from applications) a,
                       (select md5(string_agg(id::text || status, ',' order by id)) from jobs) j,
                       (select md5(string_agg(id::text || created_at::text, ',' order by id)) from applicant_forwards) f,
                       (select md5(string_agg(key || body, ',' order by key)) from admin_message_templates where key not like 'app\\_%') t`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    for (const k of ['a', 'j', 'f', 't']) if (before[k] !== after[k]) throw new Error(`a row changed (${k})`)
    const seeded = (await c.query(`select key, body from admin_message_templates where key = any($1)`, [APP_TEMPLATES.map((t) => t.key)])).rows as { key: string; body: string }[]
    if (seeded.length !== APP_TEMPLATES.length) throw new Error(`expected ${APP_TEMPLATES.length} templates, found ${seeded.length}`)
    for (const t of APP_TEMPLATES) {
      const row = seeded.find((r) => r.key === t.key)
      if (row?.body !== t.defaultBody) throw new Error(`${t.key}: seeded body differs from the code default`)
    }
    console.log(`templates: ${seeded.length} seeded, byte-for-byte the code defaults`)
    const setting = (await c.query(`select value is not null and length(value) >= 10 ok from app_settings where key = 'support.whatsapp'`)).rows[0]
    if (!setting?.ok) throw new Error('support.whatsapp setting missing')
    console.log('setting: support.whatsapp present')

    const fwd = (await c.query(`select id from applicant_forwards limit 1`)).rows[0]
    const fu = (await c.query(`select id from application_follow_ups limit 1`)).rows[0]
    const tutor = (await c.query(`select tutor_id from applications limit 1`)).rows[0]
    const staff = (await c.query(`select id from profiles where role = 'admin' and admin_role = 'owner' limit 1`)).rows[0]
    for (const who of [tutor?.tutor_id, staff?.id].filter(Boolean)) {
      for (const probe of [
        fwd ? [`update applicant_forwards set undone_at = now() where id = $1`, fwd.id] : null,
        fu ? [`update application_follow_ups set undone_at = now() where id = $1`, fu.id] : null,
      ].filter(Boolean) as [string, string][]) {
        await c.query('savepoint probe')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
        await c.query(`set local role authenticated`)
        const r = await c.query(probe[0], [probe[1]]).catch((e: { code?: string }) => ({ rowCount: e.code === '42501' ? 0 : -1 }))
        await c.query('rollback to savepoint probe')
        if (r.rowCount !== 0) throw new Error('a signed-in token could write a forward or follow-up row')
      }
    }
    console.log('lock: signed-in member and staff tokens change no forward or follow-up row')
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
