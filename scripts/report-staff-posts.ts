/** READ-ONLY: job.post counts for named staff ids (owner, 4 Nov 2026, Part E). Counts only. */
import { createClient } from '@supabase/supabase-js'
async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: ps } = await admin.from('profiles').select('id, full_name').or('full_name.ilike.%inzamam%,full_name.ilike.%zeeshan noraze%,full_name.ilike.%meerab%')
  for (const p of ps ?? []) {
    const { count } = await admin.from('admin_audit_log').select('id', { count: 'exact', head: true }).eq('action', 'job.post').eq('actor_id', p.id)
    const { data: last } = await admin.from('admin_audit_log').select('created_at').eq('action', 'job.post').eq('actor_id', p.id).order('created_at', { ascending: false }).limit(1)
    console.log(`${p.full_name} (${String(p.id).slice(0, 8)}): job.post ${count ?? 0}, last ${last?.[0]?.created_at ?? '—'}`)
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
