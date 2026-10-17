/**
 * scripts/apply-migration-186.ts — applies supabase/migrations/186_photo_lock.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no profile row changed, then — inside a savepoint that is
 * always rolled back — acts as a real tutor with an approved photo and proves:
 *   1. changing the photo is refused (TMLCK);
 *   2. after an Owner unlock, ONE change goes through and spends the unlock;
 *   3. a second change is refused again;
 *   4. hiding the photo (show_avatar) is never refused.
 * Prints counts and outcomes only — never an id, name or address.
 *   npx tsx --env-file=.env.local scripts/apply-migration-186.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/186_photo_lock.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || coalesce(avatar_url,'') || coalesce(profile_pic_status,''), ',' order by id)) h from profiles`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.n !== after.n || before.h !== after.h) throw new Error('a profile row changed')
    console.log(`profiles ${after.n}, unchanged`)

    const t = (
      await c.query(
        `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
          where p.role = 'tutor' and lower(coalesce(p.profile_pic_status,'')) = 'approved'
            and coalesce(btrim(p.avatar_url),'') <> '' and p.admin_role is null limit 1`,
      )
    ).rows[0]?.id as string | undefined
    if (!t) {
      console.log('no tutor with an approved photo — behaviour test skipped')
    } else {
      await c.query('savepoint probe')
      const claims = JSON.stringify({ sub: t, role: 'authenticated' })
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', $2, true)`, [claims, t])
      await c.query('set local role authenticated')
      const tryChange = async (url: string) => {
        await c.query('savepoint a')
        try {
          const r = await c.query(`update tutor_profiles set avatar_url = $1 where id = $2`, [url, t])
          await c.query('release savepoint a')
          return r.rowCount === 1 ? 'changed' : 'no row'
        } catch (e) {
          await c.query('rollback to savepoint a')
          return (e as { code?: string }).code === 'TMLCK' ? 'refused' : `error ${(e as Error).message}`
        }
      }
      const r1 = await tryChange('https://example.invalid/a.jpg')
      await c.query('reset role')
      await c.query(`insert into document_unlocks (user_id, item) values ($1, 'photo')`, [t])
      await c.query('set local role authenticated')
      const r2 = await tryChange('https://example.invalid/b.jpg')
      await c.query('reset role')
      const open = (await c.query(`select count(*)::int n from document_unlocks where user_id = $1 and item = 'photo' and closed_at is null`, [t])).rows[0].n
      const rereview = (await c.query(`select profile_pic_rereview_at is not null s, avatar_url = 'https://example.invalid/b.jpg' m from profiles where id = $1`, [t])).rows[0]
      await c.query('set local role authenticated')
      const r3 = await tryChange('https://example.invalid/c.jpg')
      let hide = 'refused'
      try {
        await c.query(`update tutor_profiles set show_avatar = not coalesce(show_avatar, true) where id = $1`, [t])
        hide = 'changed'
      } catch {
        /* refused */
      }
      await c.query('reset role')
      await c.query('rollback to savepoint probe')
      console.log(`locked change: ${r1}; after unlock: ${r2} (open unlocks left ${open}, mirrored ${rereview?.m}, re-review stamped ${rereview?.s}); second change: ${r3}; hide toggle: ${hide}`)
      if (r1 !== 'refused' || r2 !== 'changed' || open !== 0 || r3 !== 'refused' || hide !== 'changed' || !rereview?.m || !rereview?.s) {
        throw new Error('the photo lock did not behave as expected')
      }
    }
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
