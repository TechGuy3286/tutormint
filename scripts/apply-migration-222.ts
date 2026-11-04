/**
 * scripts/apply-migration-222.ts — applies supabase/migrations/222_member_edit_rules.sql.
 *
 * One transaction; without --apply it rolls back. After applying the file
 * (twice — it is re-runnable) it proves, each inside a SAVEPOINT that is rolled
 * back so no row changes, acting as a real member's own token:
 *   • a tutor with an APPROVED photo replacing it: avatar_url (profiles and
 *     tutor_profiles) unchanged, the new one in avatar_pending_url, the review
 *     stamp set — through either table;
 *   • a tutor with an approved CNIC renaming: saved, name_rereview_at set;
 *   • a verified mobile and an approved CNIC number are still refused;
 *   • a member cannot write the new columns directly.
 * Prints ids, counts and yes/no only — never a name, number or address.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-222.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/222_member_edit_rules.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    await c.query(sql)
    await c.query(sql)
    console.log('applied twice OK')

    const asMember = async (id: string) => {
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
    }
    const back = async () => {
      await c.query(`reset role`)
    }
    const sp = async (name: string, fn: () => Promise<void>) => {
      await c.query(`savepoint ${name}`)
      try {
        await fn()
      } finally {
        await c.query(`rollback to savepoint ${name}`)
        await back()
      }
    }

    const { rows: photo } = await c.query(
      `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
        where p.role = 'tutor' and lower(coalesce(p.profile_pic_status,'')) = 'approved'
          and coalesce(btrim(p.avatar_url),'') <> '' and p.admin_role is null limit 1`,
    )
    if (photo[0]) {
      const id = photo[0].id as string
      for (const table of ['profiles', 'tutor_profiles']) {
        await sp(`photo_${table}`, async () => {
          const before = (await c.query(`select avatar_url from profiles where id = $1`, [id])).rows[0].avatar_url
          await asMember(id)
          await c.query(`update ${table} set avatar_url = 'https://example.invalid/new.jpg' where id = $1`, [id])
          await back()
          const p = (await c.query(`select avatar_url, avatar_pending_url, profile_pic_rereview_at from profiles where id = $1`, [id])).rows[0]
          const t = (await c.query(`select avatar_url from tutor_profiles where id = $1`, [id])).rows[0]
          assert.equal(p.avatar_url, before, `${table}: profiles.avatar_url changed`)
          assert.equal(t.avatar_url, before, `${table}: tutor_profiles.avatar_url changed`)
          assert.equal(p.avatar_pending_url, 'https://example.invalid/new.jpg', `${table}: pending not set`)
          assert.ok(p.profile_pic_rereview_at, `${table}: review stamp not set`)
          console.log(`photo held via ${table}: yes (tutor ${id.slice(0, 8)})`)
        })
      }
    } else console.log('no approved-photo tutor to prove with')

    const { rows: cnic } = await c.query(
      `select id from profiles where role = 'tutor' and admin_role is null
          and (cnic_verified_at is not null or lower(coalesce(verification_state,'')) = 'approved')
          and phone_verified_at is not null and coalesce(btrim(cnic_number),'') <> '' limit 1`,
    )
    if (cnic[0]) {
      const id = cnic[0].id as string
      await sp('name', async () => {
        await asMember(id)
        await c.query(`update profiles set full_name = full_name || ' Zz' where id = $1`, [id])
        await back()
        const r = (await c.query(`select name_rereview_at, name_rereview_from is not null as has_from from profiles where id = $1`, [id])).rows[0]
        assert.ok(r.name_rereview_at && r.has_from, 'name not flagged')
        console.log('name change saved and flagged: yes')
      })
      await sp('phone', async () => {
        await asMember(id)
        await assert.rejects(c.query(`update profiles set phone_number = '923000000000' where id = $1`, [id]), /mobile number/)
        console.log('verified mobile refused: yes')
      })
      await sp('cnicnum', async () => {
        await asMember(id)
        await assert.rejects(c.query(`update profiles set cnic_number = '4210112345671' where id = $1`, [id]), /CNIC/)
        console.log('approved CNIC number refused: yes')
      })
      await sp('cols', async () => {
        await asMember(id)
        await assert.rejects(c.query(`update profiles set avatar_pending_url = 'x' where id = $1`, [id]), /permission denied/)
        console.log('member cannot write avatar_pending_url: yes')
      })
    } else console.log('no CNIC-approved tutor to prove with')

    const { rows: tpl } = await c.query(`select count(*)::int n from admin_message_templates where key = 'rereview_rejected'`)
    console.log('template rows:', tpl[0].n)

    if (apply) {
      await c.query('commit')
      console.log('COMMITTED')
    } else {
      await c.query('rollback')
      console.log('ROLLED BACK (dry run)')
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
