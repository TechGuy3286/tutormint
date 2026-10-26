/**
 * scripts/dataop-payloop-test-account.ts — the payment-page loop hotfix
 * (owner, 26 Oct 2026).
 *
 * Creates ONE throwaway tutor account in the same state as the tutor who hit
 * the loop: email sign-up (confirmed), a mobile on file but NOT verified, no
 * phone gate, a city and one subject, no payments, not onboarded. Named
 * "Test Pay Loop" and hidden_from_public, so it never reaches Browse, search,
 * the sitemap or the Overview counts. Prints only its id. Never prints the
 * password or the email it makes up.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-payloop-test-account.ts create <out.json>
 *   npx tsx --env-file=.env.local scripts/dataop-payloop-test-account.ts state <id> <state>
 *   npx tsx --env-file=.env.local scripts/dataop-payloop-test-account.ts delete <id>
 *
 * `state` puts the account into one of the states the loop test walks:
 *   unpaid | receipt_waiting | paid_docs_pending | verified
 * using rows that belong to this test account only.
 */
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, key, { auth: { persistSession: false } })

async function create(out: string) {
  const email = `payloop.${Date.now()}@example.com`
  const password = randomBytes(12).toString('base64url') + 'a1!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'tutor', full_name: 'Test Pay Loop' },
  })
  if (error || !data.user) throw error ?? new Error('no user')
  const id = data.user.id
  // Profile rows (the trigger makes them; upsert in case it did not).
  await admin.from('profiles').upsert({ id, role: 'tutor', full_name: 'Test Pay Loop', email }, { onConflict: 'id' })
  await admin.from('tutor_profiles').upsert({ id, verification_status: 'pending' }, { onConflict: 'id' })
  const p1 = await admin
    .from('profiles')
    .update({ city: 'Lahore', phone_number: '923000000917', phone_gate_required: false, phone_verified_at: null, hidden_from_public: true })
    .eq('id', id)
  if (p1.error) throw p1.error
  const p2 = await admin.from('tutor_profiles').update({ city: 'Lahore', onboarded_at: null, verified_fee_paid_at: null }).eq('id', id)
  if (p2.error) throw p2.error
  const { data: m } = await admin.from('taxonomy_master').select('id').limit(1).single()
  const s = await admin.from('tutor_subjects').insert({ tutor_id: id, master_id: m!.id })
  if (s.error) throw s.error
  writeFileSync(out, JSON.stringify({ id, email, password }))
  console.log('created test account', id)
}

async function setState(id: string, state: string) {
  // Only this test account's rows are touched.
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', id).single()
  if (p?.full_name !== 'Test Pay Loop') throw new Error('not the test account')
  await admin.from('payments').delete().eq('user_id', id)
  await admin.from('tutor_profiles').update({ verified_fee_paid_at: null }).eq('id', id)
  await admin.from('profiles').update({ cnic_verified_at: null, profile_pic_status: null, selfie_status: null, verification_state: 'none' }).eq('id', id)
  const now = new Date().toISOString()
  if (state === 'receipt_waiting') {
    const r = await admin.from('payments').insert({
      user_id: id, plan_code: 'verified', amount_pkr: 199, provider: 'manual', method: 'bank',
      provider_ref: `TM-PAYLOOP-${Date.now()}`, reference: 'TEST', screenshot_path: `${id}/test.png`, status: 'pending',
    })
    if (r.error) throw r.error
  } else if (state === 'paypro_started' || state === 'paypro_old') {
    const created = state === 'paypro_old' ? new Date(Date.now() - 30 * 3600_000).toISOString() : new Date(Date.now() - 2 * 3600_000).toISOString()
    const r = await admin.from('payments').insert({
      user_id: id, plan_code: 'verified', amount_pkr: 199, provider: 'paypro',
      provider_ref: `TM-PAYLOOP-${Date.now()}`, status: 'pending', created_at: created,
      raw: { paypro: { click2pay: 'https://example.com/never' } },
    })
    if (r.error) throw r.error
  } else if (state === 'paid_docs_pending') {
    await admin.from('tutor_profiles').update({ verified_fee_paid_at: now }).eq('id', id)
  } else if (state === 'verified') {
    await admin.from('tutor_profiles').update({ verified_fee_paid_at: now }).eq('id', id)
    await admin.from('profiles').update({ cnic_verified_at: now, profile_pic_status: 'approved', selfie_status: 'approved', verification_state: 'approved' }).eq('id', id)
  } else if (state !== 'unpaid') {
    throw new Error(`unknown state ${state}`)
  }
  console.log('state', state)
}

async function del(id: string) {
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', id).single()
  if (p?.full_name !== 'Test Pay Loop') throw new Error('not the test account')
  await admin.from('payments').delete().eq('user_id', id)
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) throw error
  console.log('deleted test account', id)
}

const [mode, a, b] = process.argv.slice(2)
const run = mode === 'create' ? create(a) : mode === 'state' ? setState(a, b) : mode === 'delete' ? del(a) : Promise.reject(new Error('mode'))
run.then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1) })
