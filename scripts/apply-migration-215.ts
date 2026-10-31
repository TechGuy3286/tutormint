/**
 * scripts/apply-migration-215.ts — applies supabase/migrations/215_single_owner_backend_support.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (re-runnable),
 * then PROVES, each inside a savepoint that is rolled back:
 *   • exactly one Owner exists;
 *   • inserting an Owner, promoting anyone to Owner, demoting the Owner,
 *     changing the Owner's role, suspending / banning / merging / marking the
 *     Owner former staff, and deleting the Owner are all refused — even here,
 *     as the database owner (the service role is weaker than this connection);
 *   • a Backend Support token reads no payments, bank credits or 'pay.%' settings;
 *   • retired templates are marked, nothing deleted, and reports any exact
 *     duplicate template bodies.
 * Prints counts and keys only — never a name, number or email.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-215.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/215_single_owner_backend_support.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const tplBefore = (await c.query(`select count(*)::int n from admin_message_templates`)).rows[0].n
    await c.query(sql)
    await c.query(sql)

    const owners = (await c.query(`select id from profiles where admin_role = 'owner'`)).rows as { id: string }[]
    console.log('owners:', owners.length)
    if (owners.length !== 1) throw new Error('expected exactly one Owner')
    const owner = owners[0].id
    const other = (await c.query(`select id from profiles where role = 'admin' and admin_role is not null and admin_role <> 'owner' limit 1`)).rows[0]?.id as string | undefined
    const member = (await c.query(`select id from profiles where role in ('tutor','parent') limit 1`)).rows[0]?.id as string

    async function refused(label: string, q: string, params: unknown[] = []): Promise<void> {
      await c.query('savepoint t')
      let ok = false
      try {
        await c.query(q, params)
        ok = true
      } catch {
        // refused, as it must be
      }
      await c.query('rollback to savepoint t')
      if (ok) throw new Error(`NOT refused: ${label}`)
      console.log('refused ✓', label)
    }

    await refused('insert a second Owner', `insert into profiles (id, role, admin_role, full_name, email) values (gen_random_uuid(), 'admin', 'owner', 'x', 'x@x.invalid')`)
    if (other) await refused('promote a staff member to Owner', `update profiles set admin_role = 'owner' where id = $1`, [other])
    await refused('promote a member to Owner', `update profiles set role = 'admin', admin_role = 'owner' where id = $1`, [member])
    await refused('demote the Owner to admin', `update profiles set admin_role = 'admin' where id = $1`, [owner])
    await refused('change the Owner to a member', `update profiles set role = 'parent', admin_role = null where id = $1`, [owner])
    await refused('suspend the Owner', `update profiles set is_suspended = true where id = $1`, [owner])
    await refused('ban the Owner', `update profiles set is_banned = true where id = $1`, [owner])
    await refused('merge the Owner away', `update profiles set merged_into = $2 where id = $1`, [owner, member])
    await refused('mark the Owner former staff', `update profiles set former_staff_at = now() where id = $1`, [owner])
    await refused('delete the Owner profile', `delete from profiles where id = $1`, [owner])
    await refused('delete the Owner auth user', `delete from auth.users where id = $1`, [owner])

    // An ordinary edit of the Owner's own profile still works (name unchanged).
    await c.query('savepoint t')
    await c.query(`update profiles set full_name = full_name where id = $1`, [owner])
    await c.query('rollback to savepoint t')
    console.log('ordinary Owner profile edit allowed ✓')

    // Backend Support reads no finance rows (a staff member made Backend Support inside a savepoint).
    if (other) {
      await c.query('savepoint t')
      await c.query(`update profiles set admin_role = 'backend_support' where id = $1`, [other])
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: other, role: 'authenticated' })])
      const pay = (await c.query(`select count(*)::int n from payments`)).rows[0].n
      const bank = (await c.query(`select count(*)::int n from bank_transfers`)).rows[0].n
      const settings = (await c.query(`select count(*)::int n from app_settings where key like 'pay.%'`)).rows[0].n
      const supportSetting = (await c.query(`select count(*)::int n from app_settings where key not like 'pay.%'`)).rows[0].n
      await c.query(`reset role`)
      await c.query('rollback to savepoint t')
      console.log('backend support sees payments/bank/pay settings:', pay, bank, settings, '· other settings:', supportSetting)
      if (pay + bank + settings !== 0) throw new Error('Backend Support can read finance rows')
    }

    const tplAfter = (await c.query(`select count(*)::int n from admin_message_templates`)).rows[0].n
    const retired = (await c.query(`select key from admin_message_templates where retired_at is not null order by key`)).rows.map((r: { key: string }) => r.key)
    console.log('templates before/after:', tplBefore, tplAfter, '· retired:', retired.join(', '))
    if (tplBefore !== tplAfter) throw new Error('template count changed')
    const dups = (await c.query(
      `select string_agg(key, ' = ' order by key) keys from admin_message_templates where retired_at is null group by md5(trim(body)) having count(*) > 1`,
    )).rows
    console.log('exact duplicate bodies among live templates:', dups.length ? dups.map((d: { keys: string }) => d.keys).join(' | ') : 'none')

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
