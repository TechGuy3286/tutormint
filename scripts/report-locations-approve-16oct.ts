/**
 * scripts/report-locations-approve-16oct.ts — READ-ONLY (owner, 16 Oct 2026).
 * What the Admin → Locations "Approve all suggestions" request(s) at 13:56–13:57
 * PKT on 16 Oct actually changed: distinct areas added, spellings saved, values
 * hidden as "Not an area", whether two requests overlapped, and duplicate areas.
 *   npx tsx --env-file=.env.local scripts/report-locations-approve-16oct.ts
 */
import { createClient } from '@supabase/supabase-js'

const pk = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(11, 19)

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: audit } = await db
    .from('admin_audit_log')
    .select('action, created_at, detail, target_id')
    .like('action', 'location.%')
    .gte('created_at', '2026-10-16T08:50:00Z')
    .lte('created_at', '2026-10-16T09:05:00Z')
    .order('created_at')
    .limit(1000)
  const rows = (audit ?? []) as { action: string; created_at: string; detail: Record<string, string | null>; target_id: string | null }[]
  console.log(`audit rows 13:50–14:05 PKT: ${rows.length}; first ${pk(rows[0].created_at)} last ${pk(rows[rows.length - 1].created_at)}`)
  for (const act of ['location.area_add', 'location.alias', 'location.not_area']) {
    const r = rows.filter((x) => x.action === act)
    const key = (x: (typeof r)[number]) => `${(x.detail.city ?? '').toLowerCase()}|${(x.detail.value ?? x.detail.from ?? x.detail.after ?? '').toLowerCase()}`
    console.log(`${act}: ${r.length} rows, ${new Set(r.map(key)).size} distinct values, ${new Set(r.map((x) => x.target_id)).size} distinct targets`)
  }
  // The added areas: are any two the same name in the same city?
  const addIds = [...new Set(rows.filter((x) => x.action === 'location.area_add').map((x) => Number(x.target_id)))]
  const { data: added } = await db.from('location_areas').select('id, name, city_id, removed_at').in('id', addIds)
  const seen = new Map<string, number[]>()
  for (const a of added ?? []) {
    const k = `${a.city_id}|${(a.name as string).toLowerCase()}`
    seen.set(k, [...(seen.get(k) ?? []), a.id as number])
  }
  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1)
  console.log(`areas added: ${added?.length ?? 0} rows (${(added ?? []).filter((a) => a.removed_at).length} retired); same name twice in one city: ${dupes.length}`)
  for (const [k, ids] of dupes.slice(0, 20)) console.log('   duplicate', k, ids.join(','))
  // Did two requests run? An area_add for the same typed value twice means yes.
  const sample = (added ?? []).slice(0, 12).map((a) => a.name).join(' · ')
  console.log('sample of added areas:', sample)
  const { count: aliases } = await db.from('location_area_aliases').select('id', { count: 'exact', head: true }).gte('created_at', '2026-10-16T08:50:00Z').lte('created_at', '2026-10-16T09:05:00Z')
  const { count: ignored } = await db.from('location_ignored').select('id', { count: 'exact', head: true }).gte('created_at', '2026-10-16T08:50:00Z').lte('created_at', '2026-10-16T09:05:00Z')
  console.log(`rows written: aliases ${aliases}, not-an-area ${ignored}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
