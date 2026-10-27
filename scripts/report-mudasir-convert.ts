/**
 * scripts/report-mudasir-convert.ts — READ ONLY (owner, 27 Oct 2026).
 *
 * Every account named like "Mudasir Hussain": role, document statuses, fee,
 * tuitions, payments, recent admin actions — and whether its mobile, CNIC or
 * email equals another account's (as yes/no, never the value). Then replays the
 * Change to Tutor writes for the parent account inside a transaction that is
 * ALWAYS rolled back, to capture the exact database error. Changes nothing.
 * Never prints a phone number, email or CNIC number.
 *
 *   npx tsx --env-file=.env.local scripts/report-mudasir-convert.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-10)

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const ps = await c.query(
      `select p.id, p.full_name, p.role, p.created_at, p.city, p.phone_number, p.phone_verified_at is not null as phone_verified,
              p.cnic_number, p.verification_state, p.cnic_verified_at is not null as cnic_approved, p.address_status,
              p.address_verified_at is not null as address_approved, p.profile_pic_status, p.selfie_status, p.linked_account_id,
              p.merged_into, p.is_suspended, p.hidden_from_public, p.admin_role,
              u.email, tp.id is not null as has_tutor_profile, tp.verified_fee_paid_at is not null as fee_paid, tp.onboarded_at is not null as onboarded
         from profiles p join auth.users u on u.id = p.id left join tutor_profiles tp on tp.id = p.id
        where p.full_name ilike '%muda%sir%' or p.full_name ilike '%mudas%'`,
    )
    const rows = ps.rows
    for (const p of rows) {
      const others = rows.filter((o: { id: string }) => o.id !== p.id)
      console.log('\nAccount', p.id, '|', p.full_name, '| role', p.role, '| city', p.city, '| joined', p.created_at.toISOString().slice(0, 10))
      console.log('  phone verified', p.phone_verified, '| cnic', p.cnic_number ? 'on file' : 'none', '| cnic approved', p.cnic_approved, p.verification_state,
        '| address', p.address_status, p.address_approved, '| photo', p.profile_pic_status, '| selfie', p.selfie_status)
      console.log('  tutor profile', p.has_tutor_profile, '| fee paid', p.fee_paid, '| onboarded', p.onboarded, '| linked', p.linked_account_id, '| merged', p.merged_into,
        '| suspended', p.is_suspended, '| hidden', p.hidden_from_public, '| staff', p.admin_role)
      console.log('  synthetic email', String(p.email).endsWith('@users.tutormint.org'))
      for (const o of others)
        console.log('  vs', o.id, ': same mobile digits', digits(p.phone_number) !== '' && digits(p.phone_number) === digits(o.phone_number),
          '| same raw mobile', p.phone_number === o.phone_number, '| same cnic', !!p.cnic_number && p.cnic_number === o.cnic_number,
          '| same email', p.email === o.email)
      const jobs = await c.query(`select status, count(*)::int n from jobs where parent_id = $1 group by status`, [p.id])
      console.log('  tuitions', jobs.rows)
      const pays = await c.query(`select plan_code, status, provider, refunded_at is not null refunded, created_at from payments where user_id = $1 order by created_at`, [p.id])
      console.log('  payments', pays.rows.map((x: { plan_code: string; status: string; provider: string; refunded: boolean }) => `${x.plan_code}/${x.status}/${x.provider}${x.refunded ? '/refunded' : ''}`))
      const docs = await c.query(`select kind, side, status, review_status from user_documents where user_id = $1 order by created_at`, [p.id]).catch(async () =>
        c.query(`select kind, status from user_documents where user_id = $1 order by created_at`, [p.id]))
      console.log('  documents', docs.rows)
      const audit = await c.query(
        `select action, created_at, detail - 'reason' as detail from admin_audit_log where target_id = $1::text order by created_at desc limit 15`, [p.id])
      for (const a of audit.rows) console.log('  audit', a.created_at.toISOString(), a.action, JSON.stringify(a.detail).slice(0, 160))
    }

    // Replay Change to Tutor on each parent account, rolled back.
    for (const p of rows.filter((r: { role: string }) => r.role === 'parent')) {
      console.log('\nReplay Change to Tutor (rolled back) for', p.id)
      await c.query('begin')
      try {
        await c.query(`update profiles set role = 'tutor', account_type = null where id = $1 and role = 'parent'`, [p.id])
        console.log('  role update: ok')
        const tp = await c.query(`select id from tutor_profiles where id = $1`, [p.id])
        if (tp.rowCount) {
          await c.query(`update tutor_profiles set converted_to_parent_at = null, converted_to_parent_by = null where id = $1`, [p.id])
        } else {
          await c.query(`insert into tutor_profiles (id, full_name, city, verification_status) values ($1, $2, $3, 'pending')`, [p.id, p.full_name, p.city])
        }
        console.log('  tutor profile: ok')
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string; table?: string }
        console.log('  ERROR code', err.code, '| constraint', err.constraint, '| table', err.table, '|', String(err.message).replace(/\d{5,}/g, '<digits>'))
      } finally {
        await c.query('rollback')
        console.log('  rolled back')
      }
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/\d{5,}/g, '<digits>'))
  process.exit(1)
})
