/**
 * scripts/report-onboarding-done.ts — READ-ONLY.
 *
 * Why tutors stopped reaching "Onboarding done" (owner, 15 Oct 2026, PR A).
 * For every real tutor who signed up since 25 Sep: the steps done, the step
 * they are on (the shared stoppedAtLabel rule), last activity, paid or not,
 * and tutor_profiles.onboarded_at. Then the onboarding-mode switch history and
 * the stuck-per-step counts for 25 Sep–7 Oct vs 8 Oct → now.
 *   npx tsx --env-file=.env.local scripts/report-onboarding-done.ts
 * Names are initials, mobiles masked. Nothing is written.
 */
import { createClient } from '@supabase/supabase-js'
import { flowStateByTutor } from '../lib/onboardingStop'
import { NEW_FLOW_ORDER, stepDone } from '../lib/tutorFlow'

const initials = (n: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('')
const mask = (m: string | null) => (m ? `${m.slice(0, 4)}•••${m.slice(-2)}` : '—')
const pk = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '—')

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const { data: setting } = await admin.from('app_settings').select('*').eq('key', 'onboarding.new_mode').maybeSingle()
  console.log('onboarding.new_mode =', JSON.stringify(setting))
  const { data: audits } = await admin
    .from('admin_audit_log')
    .select('action, detail, created_at, actor_email')
    .or('action.ilike.%onboarding%,detail::text.ilike.%new_mode%')
    .order('created_at', { ascending: true })
    .limit(50)
  for (const a of audits ?? []) console.log('audit', pk(a.created_at as string), a.action, JSON.stringify(a.detail).slice(0, 160))

  const since = '2026-09-25T00:00:00+05:00'
  const { data: ps } = await admin
    .from('profiles')
    .select('id, full_name, phone_number, created_at, role, admin_role, is_seed, is_team_account, is_test_name, hidden_from_public, is_banned, is_suspended')
    .eq('role', 'tutor')
    .gte('created_at', since)
    .order('created_at')
    .range(0, 4999)
  const real = (ps ?? []).filter((p) => !p.admin_role && !p.is_seed && !p.is_team_account && !p.is_test_name && !p.hidden_from_public)
  const ids = real.map((p) => p.id as string)

  const tp = new Map<string, { onboarded_at: string | null; verified_fee_paid_at: string | null; updated_at: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('tutor_profiles').select('id, onboarded_at, verified_fee_paid_at, updated_at').in('id', ids.slice(i, i + 200))
    for (const t of data ?? []) tp.set(t.id as string, t as never)
  }
  const last = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('user_activity_log').select('user_id, created_at').in('user_id', ids.slice(i, i + 100)).order('created_at', { ascending: false }).range(0, 9999)
    for (const r of data ?? []) if (!last.has(r.user_id as string)) last.set(r.user_id as string, r.created_at as string)
  }
  const state = new Map<string, Awaited<ReturnType<typeof flowStateByTutor>> extends Map<string, infer V> ? V : never>()
  for (let i = 0; i < ids.length; i += 80) for (const [k, v] of await flowStateByTutor(admin, ids.slice(i, i + 80))) state.set(k, v)

  const cut = new Date('2026-10-08T00:00:00+05:00').getTime()
  const before = new Map<string, number>()
  const after = new Map<string, number>()
  console.log('\njoined(PKT)       | who | mobile      | steps | on                  | paid | onboarded_at      | last activity')
  for (const p of real) {
    const id = p.id as string
    const s = state.get(id)
    const t = tp.get(id)
    const done = s ? NEW_FLOW_ORDER.filter((k) => stepDone(s.facts, k)).length : 0
    const on = s?.stoppedAt ?? 'all done'
    const joined = new Date(p.created_at as string).getTime()
    const bucket = joined >= cut ? after : before
    bucket.set(on, (bucket.get(on) ?? 0) + 1)
    if (joined >= cut) {
      console.log(
        `${pk(p.created_at as string)} | ${initials(p.full_name as string).padEnd(3)} | ${mask(p.phone_number as string).padEnd(11)} | ${String(done).padStart(2)}/${NEW_FLOW_ORDER.length} | ${on.padEnd(19)} | ${t?.verified_fee_paid_at ? 'yes ' : 'no  '} | ${pk(t?.onboarded_at ?? null).padEnd(16)} | ${pk(last.get(id) ?? null)}${p.is_suspended ? ' (paused)' : ''} | ${(s?.missing ?? []).filter((m) => !/Verification Fee/.test(m)).join('; ')}`,
      )
    }
  }
  const keys = [...new Set([...before.keys(), ...after.keys()])]
  console.log('\nstuck at            | 25 Sep–7 Oct | 8 Oct–now')
  for (const k of keys) console.log(`${k.padEnd(19)} | ${String(before.get(k) ?? 0).padStart(12)} | ${String(after.get(k) ?? 0).padStart(9)}`)

  // onboarded_at by day
  const byDay = new Map<string, number>()
  for (const [, t] of tp) if (t.onboarded_at) { const d = pk(t.onboarded_at).slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1) }
  console.log('\nonboarded_at stamped per day (joined since 25 Sep):', JSON.stringify([...byDay].sort()))
}

main().catch((e) => { console.error(e); process.exit(1) })
