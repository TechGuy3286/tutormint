/**
 * scripts/test-edit-profile-live.ts — npm run test:editprofile:live (read only)
 *
 * Proves the Edit Profile rules (owner, 4 Nov 2026; migration 222) in the live
 * database, acting with a real member's OWN token and with the service role
 * staff routes use — every write inside ONE transaction that is rolled back, so
 * no row changes. Prints yes/no only — never a name, number or address.
 *   • Mobile (verified) and CNIC number (approved): refused for the member,
 *     allowed for staff.
 *   • After approval the member can still change name, WhatsApp, tagline,
 *     about, city, job types, fee, show_avatar, areas and subjects.
 *   • A name change with an approved CNIC is saved and flagged.
 *   • A replaced approved photo: the approved one stays public, the new one
 *     waits, the review stamp is set; the badge columns are untouched.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
let ready: Promise<void> | null = null
let n = 0
function open() {
  ready ??= (async () => {
    await c.connect()
    await c.query('begin')
  })()
  return ready
}
after(async () => {
  await c.query('rollback').catch(() => {})
  await c.end().catch(() => {})
})

async function inSavepoint(fn: () => Promise<void>) {
  await open()
  const sp = `sp${++n}`
  await c.query(`savepoint ${sp}`)
  try {
    await fn()
  } finally {
    await c.query(`rollback to savepoint ${sp}`)
    await c.query('reset role')
  }
}
async function asMember(id: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
}
async function asStaffRoute() {
  await c.query('set local role service_role')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })])
}

async function approvedTutor(): Promise<string | null> {
  await open()
  const { rows } = await c.query(
    `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
      where p.role = 'tutor' and p.admin_role is null
        and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state,'')) = 'approved')
        and lower(coalesce(p.profile_pic_status,'')) = 'approved' and coalesce(btrim(p.avatar_url),'') <> ''
        and p.phone_verified_at is not null and coalesce(btrim(p.cnic_number),'') <> ''
      limit 1`,
  )
  return (rows[0]?.id as string) ?? null
}

test('verified mobile and approved CNIC number: refused for the member, allowed for staff', async (t) => {
  const id = await approvedTutor()
  if (!id) return t.skip('no approved tutor')
  await inSavepoint(async () => {
    await asMember(id)
    await assert.rejects(c.query(`update profiles set phone_number = '923000000001' where id = $1`, [id]), /mobile number/)
  })
  await inSavepoint(async () => {
    await asMember(id)
    await assert.rejects(c.query(`update profiles set cnic_number = '4210199999991' where id = $1`, [id]), /CNIC/)
  })
  await inSavepoint(async () => {
    await asStaffRoute()
    await c.query(`update profiles set phone_number = '923000000001', cnic_number = '4210199999991' where id = $1`, [id])
  })
})

test('every other field stays editable after approval', async (t) => {
  const id = await approvedTutor()
  if (!id) return t.skip('no approved tutor')
  await inSavepoint(async () => {
    await asMember(id)
    await c.query(`update profiles set full_name = full_name || ' Zz', whatsapp = '923000000002' where id = $1`, [id])
    await c.query(
      `update tutor_profiles set headline = 'A new tagline', bio = 'A new about', city = 'Lahore', job_types = array['Home Tutor'],
              fee_min_pkr = 5000, fee_max_pkr = 9000, show_avatar = false where id = $1`,
      [id],
    )
    await c.query(`insert into tutor_areas (tutor_id, city, area) values ($1, 'Lahore', 'Zz Test Area')`, [id])
    const { rows } = await c.query(`select master_id from tutor_subjects where tutor_id = $1 limit 1`, [id])
    if (rows[0]) await c.query(`delete from tutor_subjects where tutor_id = $1 and master_id = $2`, [id, rows[0].master_id])
  })
})

test('a name change with an approved CNIC is saved and flagged', async (t) => {
  const id = await approvedTutor()
  if (!id) return t.skip('no approved tutor')
  await inSavepoint(async () => {
    await asMember(id)
    await c.query(`update profiles set full_name = full_name || ' Zz' where id = $1`, [id])
    await c.query('reset role')
    const { rows } = await c.query(`select name_rereview_at is not null as flagged, name_rereview_from is not null as has_from, full_name like '% Zz' as saved from profiles where id = $1`, [id])
    assert.deepEqual(rows[0], { flagged: true, has_from: true, saved: true })
  })
})

test('a replaced approved photo waits; the approved one stays public; the badge columns stay', async (t) => {
  const id = await approvedTutor()
  if (!id) return t.skip('no approved tutor')
  for (const table of ['profiles', 'tutor_profiles']) {
    await inSavepoint(async () => {
      const before = (await c.query(`select p.avatar_url, p.profile_pic_status, p.selfie_status, p.cnic_verified_at, tp.verified_fee_paid_at from profiles p join tutor_profiles tp on tp.id = p.id where p.id = $1`, [id])).rows[0]
      await asMember(id)
      await c.query(`update ${table} set avatar_url = 'https://example.invalid/new.jpg' where id = $1`, [id])
      await c.query('reset role')
      const p = (await c.query(`select p.avatar_url, p.avatar_pending_url, p.profile_pic_rereview_at is not null as stamped, p.profile_pic_status, p.selfie_status, p.cnic_verified_at, tp.verified_fee_paid_at, tp.avatar_url as public_url from profiles p join tutor_profiles tp on tp.id = p.id where p.id = $1`, [id])).rows[0]
      assert.equal(p.avatar_url, before.avatar_url, `${table}: approved photo kept`)
      assert.equal(p.public_url, before.avatar_url, `${table}: public photo kept`)
      assert.equal(p.avatar_pending_url, 'https://example.invalid/new.jpg')
      assert.equal(p.stamped, true)
      assert.equal(p.profile_pic_status, before.profile_pic_status)
      assert.equal(p.selfie_status, before.selfie_status)
      assert.deepEqual(p.cnic_verified_at, before.cnic_verified_at)
      assert.deepEqual(p.verified_fee_paid_at, before.verified_fee_paid_at)
    })
  }
})

test('a member cannot write the waiting-photo or name-flag columns directly', async (t) => {
  const id = await approvedTutor()
  if (!id) return t.skip('no approved tutor')
  for (const col of ['avatar_pending_url', 'name_rereview_at']) {
    await inSavepoint(async () => {
      await asMember(id)
      await assert.rejects(c.query(`update profiles set ${col} = null where id = $1`, [id]), /permission denied/)
    })
  }
})
