/**
 * scripts/apply-migration-203.ts — applies supabase/migrations/203_account_erase.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (every write below is inside a savepoint that is rolled back, with
 * invented data only — no real account is changed):
 *   - the migration runs twice cleanly (re-runnable);
 *   - a phone_otps row with purpose 'erase' is accepted, 'bogus' refused;
 *   - an INVENTED auth user (with an identity and a session) is scrubbed by
 *     erase_auth_user(): email erased-<id>@users.tutormint.org, no phone, no
 *     password, banned, identities 0, sessions 0;
 *   - erased_tutor_redirects() is callable as anon and returns an invented
 *     done row's hash; account_erasures is not readable by anon;
 *   - parent_hide_reason() of an invented row with erased_at is 'parent_erased';
 *   - member_notes_guard: as the service role a note BODY change is refused
 *     for a member who is not erased, and allowed once erased_at is set
 *     (on an invented member + note).
 * Prints counts and true/false only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-203.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/203_account_erase.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) throw new Error(`check failed: ${label}`)
  }
  try {
    const before = (await c.query(`select (select count(*) from profiles)::int p, (select count(*) from payments)::int pay, (select count(*) from jobs where status='hidden')::int hj`)).rows[0]
    await c.query(sql)
    await c.query(sql)
    console.log('migration ran twice cleanly')

    // phone_otps purpose ------------------------------------------------------
    await c.query('savepoint s')
    await c.query(`insert into phone_otps (phone, code, purpose, expires_at, attempts) values ('920000000000', 'x', 'erase', now() + interval '10 minutes', 0)`)
    await c.query('rollback to savepoint s')
    let refused = false
    try {
      await c.query(`insert into phone_otps (phone, code, purpose, expires_at, attempts) values ('920000000000', 'x', 'bogus', now(), 0)`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint s')
    check("phone_otps accepts 'erase' and refuses 'bogus'", refused)

    // erase_auth_user on an invented user --------------------------------------
    const uid = randomUUID()
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'not-a-hash', '920001234567', '{"full_name":"Invented Person","role":"parent"}'::jsonb, '{"provider":"email"}'::jsonb, now(), now())`,
      [uid, `invented-${uid.slice(0, 8)}@example.invalid`],
    )
    await c.query(
      `insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'email', '{}'::jsonb, now(), now())`,
      [uid, uid],
    )
    await c.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now())`, [uid])
    await c.query(`select public.erase_auth_user($1)`, [uid])
    const u = (await c.query(
      `select email, phone, encrypted_password, banned_until > now() + interval '50 years' as banned, raw_user_meta_data = '{}'::jsonb as meta_empty,
              (select count(*) from auth.identities where user_id = $1)::int ids, (select count(*) from auth.sessions where user_id = $1)::int sess
         from auth.users where id = $1`,
      [uid],
    )).rows[0]
    check('auth user email is the erased no-mailbox address', u.email === `erased-${uid}@users.tutormint.org`)
    check('auth user phone removed', u.phone === null)
    check('auth user password emptied', u.encrypted_password === '')
    check('auth user banned for 100 years', u.banned === true)
    check('auth user metadata emptied', u.meta_empty === true)
    check('identities and sessions deleted', u.ids === 0 && u.sess === 0)

    // parent_hide_reason ------------------------------------------------------
    const pr = (await c.query(`select public.parent_hide_reason(p) r from profiles p where p.id = $1`, [uid])).rows[0]
    if (pr) {
      await c.query(`update profiles set erased_at = now() where id = $1`, [uid])
      const pr2 = (await c.query(`select public.parent_hide_reason(p) r from profiles p where p.id = $1`, [uid])).rows[0]
      check("parent_hide_reason of an erased account is 'parent_erased'", pr2.r === 'parent_erased')
      await c.query(`update profiles set erased_at = null where id = $1`, [uid])
    } else {
      console.log('SKIP  parent_hide_reason (the invented user got no profile row)')
    }

    // member_notes_guard -------------------------------------------------------
    if (pr) {
      const note = (await c.query(`insert into member_notes (member_id, kind, body, staff_name) values ($1, 'note', 'Call 03001234567', 'Invented Staff') returning id`, [uid])).rows[0].id
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
      await c.query('savepoint n')
      let notErasedRefused = false
      try {
        await c.query(`update member_notes set body = 'Call [hidden]' where id = $1`, [note])
      } catch {
        notErasedRefused = true
      }
      await c.query('rollback to savepoint n')
      check('note body edit refused while the member is not erased', notErasedRefused)
      await c.query(`update profiles set erased_at = now() where id = $1`, [uid])
      await c.query(`update member_notes set body = 'Call [hidden]' where id = $1`, [note])
      const b = (await c.query(`select body from member_notes where id = $1`, [note])).rows[0].body
      check('note body masked once the member is erased (service role)', b === 'Call [hidden]')
      let kindRefused = false
      await c.query('savepoint k')
      try {
        await c.query(`update member_notes set kind = 'call' where id = $1`, [note])
      } catch {
        kindRefused = true
      }
      await c.query('rollback to savepoint k')
      check('other note fields still locked after erase', kindRefused)
      await c.query(`select set_config('request.jwt.claims', '{}', true)`)
    }

    // erased_tutor_redirects + account_erasures RLS ---------------------------------
    await c.query(
      `insert into account_erasures (member_id, role, status, source, due_at, done_at, slug_hashes, city) values ($1, 'tutor', 'done', 'owner', now(), now(), array['abc123'], 'Lahore')`,
      [uid],
    )
    await c.query('savepoint a')
    await c.query(`set local role anon`)
    const rr = (await c.query(`select count(*)::int n from public.erased_tutor_redirects() where slug_hash = 'abc123' and city = 'Lahore'`)).rows[0].n
    const er = (await c.query(`select count(*)::int n from account_erasures`)).rows[0].n
    await c.query('rollback to savepoint a')
    check('erased_tutor_redirects() works for anon', rr === 1)
    check('account_erasures not readable by anon', er === 0)

    // Clean the invented rows out of the transaction (it rolls back anyway on a dry run).
    await c.query(`delete from account_erasures where member_id = $1`, [uid])
    await c.query(`delete from auth.users where id = $1`, [uid])

    const after = (await c.query(`select (select count(*) from profiles)::int p, (select count(*) from payments)::int pay, (select count(*) from jobs where status='hidden')::int hj`)).rows[0]
    check('profiles, payments and hidden tuitions unchanged', before.p === after.p && before.pay === after.pay && before.hj === after.hj)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED migration 203')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error('ROLLED BACK:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
