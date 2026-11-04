/**
 * scripts/report-staff-list.ts — READ-ONLY.
 *
 * Owner, 4 Nov 2026 (Part E): who "Zeeshan Noraze" is, why Inzamam Ullah no
 * longer shows on Team activity, and every account with a staff role.
 *   npx tsx --env-file=.env.local scripts/report-staff-list.ts
 * Names, roles and dates only — no emails, phone numbers or keys. Writes nothing.
 */
import { createClient } from '@supabase/supabase-js'

const pk = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') + ' PKT' : '—')

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name, role, admin_role, is_suspended, is_banned, former_staff_at, former_staff_role, created_at')
    .or('role.eq.admin,admin_role.not.is.null,former_staff_at.not.is.null')
  const { data: tenure } = await admin.from('staff_tenure').select('*')
  const tenureBy = new Map((tenure ?? []).map((t) => [t.staff_id ?? t.member_id ?? t.id, t]))
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, (s.full_name as string) ?? '—']))

  const audit = async (ids: string[], label: string) => {
    if (!ids.length) return
    const { data: asTarget } = await admin.from('admin_audit_log').select('action, actor_id, actor_role, detail, created_at').in('target_id', ids).order('created_at')
    const { data: asActor } = await admin.from('admin_audit_log').select('action, created_at').in('actor_id', ids).order('created_at')
    console.log(`\n${label} — audit rows naming them (${asTarget?.length ?? 0}):`)
    for (const a of asTarget ?? []) {
      if (!/staff|role|team|former|member\.(suspend|ban|merge|convert)|second_role/.test(a.action as string)) continue
      const d = JSON.stringify(a.detail ?? {}).replace(/"[^"]*@[^"]*"/g, '"<email>"').replace(/\d{10,}/g, '<number>').slice(0, 220)
      console.log(`  ${pk(a.created_at as string)} ${a.action} by ${nameOf.get(a.actor_id as string) ?? a.actor_id} (${a.actor_role}) ${d}`)
    }
    const acts = new Map<string, number>()
    for (const a of asActor ?? []) acts.set(a.action as string, (acts.get(a.action as string) ?? 0) + 1)
    console.log(`  Their own actions: ${[...acts].map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`)
    console.log(`  First / last action: ${pk(asActor?.[0]?.created_at as string)} / ${pk(asActor?.[asActor.length - 1]?.created_at as string)}`)
  }

  for (const [q, label] of [['zeeshan', 'Zeeshan'], ['noraze', 'Noraze'], ['inzamam', 'Inzamam']] as const) {
    const { data } = await admin.from('profiles').select('id, full_name, role, admin_role, is_suspended, former_staff_at, former_staff_role, created_at').ilike('full_name', `%${q}%`)
    console.log(`\nAccounts named like "${label}": ${data?.length ?? 0}`)
    for (const p of data ?? []) {
      const t = tenureBy.get(p.id as string)
      console.log(`  ${p.full_name} · id ${String(p.id).slice(0, 8)} · role ${p.role}/${p.admin_role ?? '—'} · suspended ${!!p.is_suspended} · former ${pk(p.former_staff_at as string)} (${p.former_staff_role ?? '—'}) · account ${pk(p.created_at as string)} · joined ${pk(t?.joined_at)} by ${t?.joined_by_name ?? '—'} (${t?.source ?? '—'})`)
    }
    await audit((data ?? []).map((p) => p.id as string), label)
  }

  // Staff named on Team activity → Tuitions posted: every job.post actor.
  const { data: posts } = await admin.from('admin_audit_log').select('actor_id').eq('action', 'job.post').range(0, 9999)
  const posters = new Map<string, number>()
  for (const p of posts ?? []) posters.set(p.actor_id as string, (posters.get(p.actor_id as string) ?? 0) + 1)
  const { data: posterProfiles } = await admin.from('profiles').select('id, full_name, role, admin_role, former_staff_at').in('id', [...posters.keys()])
  console.log('\nEveryone who ever posted a tuition as staff (job.post):')
  for (const p of posterProfiles ?? []) console.log(`  ${p.full_name} · ${p.role}/${p.admin_role ?? '—'} · former ${p.former_staff_at ? 'yes' : 'no'} · posts ${posters.get(p.id as string)}`)

  console.log('\nEvery account with a staff role now (role=admin and admin_role set):')
  for (const s of (staff ?? []).filter((x) => x.role === 'admin' && x.admin_role).sort((a, b) => String(a.admin_role).localeCompare(String(b.admin_role)))) {
    const t = tenureBy.get(s.id as string)
    console.log(`  ${s.full_name} · ${s.admin_role} · suspended ${!!s.is_suspended} · joined ${pk(t?.joined_at)} (added by ${t?.joined_by_name ?? '—'}) · account ${pk(s.created_at as string)}`)
  }
  console.log('\nFormer staff:')
  for (const s of (staff ?? []).filter((x) => x.former_staff_at)) console.log(`  ${s.full_name} · was ${s.former_staff_role ?? '—'} · left ${pk(s.former_staff_at as string)}`)
  console.log(`\nstaff_tenure columns: ${Object.keys(tenure?.[0] ?? {}).join(', ')}`)
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
