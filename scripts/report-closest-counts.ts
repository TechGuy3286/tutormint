/**
 * scripts/report-closest-counts.ts — READ-ONLY.
 *
 * Owner, 5 Nov 2026: the stored "Closest to paying" counts, the Overview
 * "Ready to pay" number, and whether any deleted account is still in People's
 * waiting chip. Counts only — no names, phones or emails. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-closest-counts.ts
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: state } = await admin.from('admin_summary').select('payload, computed_at').eq('key', 'state').maybeSingle()
  console.log('summary built at:', (state?.payload as { builtAt?: string } | null)?.builtAt ?? '—')
  const { data: rows } = await admin.from('admin_list_rows').select('tags').eq('list', 'fu_tutor:closest')
  const c: Record<string, number> = {}
  for (const r of rows ?? []) {
    const k = String((r.tags as { closest?: string }).closest)
    c[k] = (c[k] ?? 0) + 1
  }
  console.log('closest list rows:', rows?.length ?? 0, c)
  const { data: ov } = await admin.from('admin_summary').select('payload').eq('key', 'overview:7').maybeSingle()
  const p = (ov?.payload ?? {}) as Record<string, { count?: number }>
  console.log('overview todo-ready-to-pay:', p['todo-ready-to-pay']?.count ?? '(not stored yet)', '· todo-docs:', p['todo-docs']?.count ?? '—')
  const { data: er } = await admin.from('account_erasures').select('member_id').eq('status', 'done')
  const ids = (er ?? []).map((e) => e.member_id as string)
  const { data: people } = await admin.from('admin_list_rows').select('member_id, tags').eq('list', 'people:tutor').in('member_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const waitingReal = (people ?? []).filter((r) => (r.tags as Record<string, unknown>).docs === 'waiting' && (r.tags as Record<string, unknown>).excluded === false).length
  console.log('deleted accounts in people:tutor:', people?.length ?? 0, '· tagged deleted:', (people ?? []).filter((r) => (r.tags as Record<string, unknown>).deleted === true).length, '· still in the default Waiting chip:', waitingReal)
  const { count: waiting } = await admin
    .from('admin_list_rows')
    .select('member_id', { count: 'exact', head: true })
    .eq('list', 'people:tutor')
    .contains('tags', { excluded: false, docs: 'waiting' })
  console.log('People → Tutors → Waiting (default view):', waiting)
  const { data: b } = await admin.from('admin_summary').select('payload').eq('key', 'badges').maybeSingle()
  console.log('People badge (documents waiting):', (b?.payload as { peopleWaiting?: number } | null)?.peopleWaiting ?? '—')
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : 'failed'); process.exit(1) })
