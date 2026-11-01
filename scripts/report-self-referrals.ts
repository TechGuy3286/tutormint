// scripts/report-self-referrals.ts — READ ONLY (owner, 2 Nov 2026, Part H).
// Every account credited to a staff member's link, code or claim, checked
// against THAT staff member with the self-referral rule (lib/selfReferralCore):
// same phone, same CNIC, or the same normalised name together with the same
// device or IP at sign-up. Prints names, ids and which facts matched — never a
// phone, CNIC, email, IP or device value. Changes nothing.
//   npx tsx --env-file=.env.local scripts/report-self-referrals.ts
import { createClient } from '@supabase/supabase-js'
import { selfReferralMatch, type SelfReferralPerson } from '../lib/selfReferralCore'

type Row = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all(db: any, table: string, cols: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order('created_at').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) return out
  }
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const credits = (await all(db, 'staff_signup_credits', 'member_id, staff_id, source, member_role, created_at')).filter((c) => c.staff_id)
  const ids = [...new Set([...credits.map((c) => c.member_id as string), ...credits.map((c) => c.staff_id as string)])]
  const people = new Map<string, Row>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from('profiles')
      .select('id, full_name, phone_number, whatsapp, secondary_phone, cnic_number, created_at, admin_role, former_staff_at')
      .in('id', ids.slice(i, i + 200))
    for (const p of data ?? []) people.set(p.id as string, p as Row)
  }
  // Devices: the stored sign-up / staff device rows (from this PR on), plus the
  // browser line of their activity sessions as a weaker hint for the past.
  const { data: devRows } = await db.from('member_device_marks').select('member_id, device_hash, ip_hash, kind')
  const devices = new Map<string, { devices: Set<string>; ips: Set<string> }>()
  for (const d of devRows ?? []) {
    const k = d.member_id as string
    const e = devices.get(k) ?? { devices: new Set(), ips: new Set() }
    if (d.device_hash) e.devices.add(d.device_hash as string)
    if (d.ip_hash) e.ips.add(d.ip_hash as string)
    devices.set(k, e)
  }
  const uas = new Map<string, Set<string>>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('activity_sessions').select('user_id, user_agent').in('user_id', ids.slice(i, i + 200)).limit(5000)
    for (const s of data ?? []) {
      if (!s.user_agent) continue
      const set = uas.get(s.user_id as string) ?? new Set()
      set.add(s.user_agent as string)
      uas.set(s.user_id as string, set)
    }
  }
  const person = (id: string): SelfReferralPerson | null => {
    const p = people.get(id)
    if (!p) return null
    const d = devices.get(id)
    return {
      name: (p.full_name as string | null) ?? null,
      phones: [p.phone_number, p.whatsapp, p.secondary_phone].map((x) => (x as string | null) ?? null),
      cnic: (p.cnic_number as string | null) ?? null,
      devices: [...(d?.devices ?? [])],
      ips: [...(d?.ips ?? [])],
    }
  }
  let n = 0
  console.log('member | member id | credited staff | staff id | source | matched on | same browser line (hint)')
  for (const c of credits) {
    const m = person(c.member_id as string)
    const s = person(c.staff_id as string)
    if (!m || !s) continue
    const hit = selfReferralMatch(m, s)
    const ua = [...(uas.get(c.member_id as string) ?? [])].some((u) => uas.get(c.staff_id as string)?.has(u))
    const nameOnly = selfReferralMatch(m, { ...s, devices: m.devices.length ? m.devices : ['x'], ips: [] }, { nameAlone: true })
    if (!hit.match && !(nameOnly.match && ua)) continue
    n++
    const mp = people.get(c.member_id as string)!
    const sp = people.get(c.staff_id as string)!
    console.log(
      `${mp.full_name} | ${c.member_id} | ${sp.full_name} | ${c.staff_id} | ${c.source} | ${hit.match ? hit.reasons.join('+') : 'name only'} | ${ua ? 'yes' : 'no'}`,
    )
  }
  console.log(`${n} possible self-referral(s) out of ${credits.length} staff credits. Nothing was changed.`)
}
main()
