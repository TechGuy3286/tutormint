/**
 * scripts/report-followup-numbers.ts — READ-ONLY.
 *
 * Owner, 16 Nov 2026 (PR-02): why does a tutor approved today show a high
 * "Follow-up N due"? Lists, for the stored People cards whose follow-up count
 * in their stage is high, where each counted contact came from — dates,
 * sources, kinds and stages only. No names, phones or emails. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-followup-numbers.ts [minSent]
 */
import { createClient } from '@supabase/supabase-js'

type Row = { member_id: string; tags: Record<string, unknown>; row: { pipe?: { stage: string; approvedAt?: string | null; follow?: { sent: number } | null } } }

async function main() {
  const minSent = Number(process.argv[2] ?? 4)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('admin_list_rows').select('member_id, tags, row').eq('list', 'people:tutor').order('member_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  const high = rows.filter((r) => r.tags.excluded === false && (r.row.pipe?.follow?.sent ?? 0) >= minSent)
  console.log(`stored cards with ${minSent}+ follow-ups in their stage:`, high.length)
  const dist: Record<string, number> = {}
  for (const r of rows.filter((x) => x.tags.excluded === false && x.row.pipe?.follow)) {
    const k = `${r.row.pipe!.stage}:${r.row.pipe!.follow!.sent}`
    dist[k] = (dist[k] ?? 0) + 1
  }
  console.log('stage:sent distribution', JSON.stringify(dist))
  let n = 0
  for (const r of high.slice(0, 8)) {
    n++
    const id = r.member_id
    const [{ data: fus }, { data: calls }, { data: notes }] = await Promise.all([
      admin.from('member_follow_ups').select('created_at, channel, template_key, progress, source, undone_at').eq('member_id', id).order('created_at'),
      admin.from('tutor_contact_logs').select('created_at, outcome').eq('tutor_id', id).order('created_at'),
      admin.from('member_notes').select('created_at, kind, withdrawn_at').eq('member_id', id).order('created_at'),
    ])
    const p = r.row.pipe!
    console.log(`\n#${n} stage=${p.stage} sent=${p.follow?.sent} approvedAt=${p.approvedAt ?? '—'}`)
    for (const f of fus ?? []) console.log('  fu  ', f.created_at, f.channel, f.source, f.template_key, f.progress, f.undone_at ? 'UNDONE' : '')
    for (const c of calls ?? []) console.log('  call', c.created_at, c.outcome)
    for (const x of notes ?? []) console.log('  note', x.created_at, x.kind, x.withdrawn_at ? 'WITHDRAWN' : '')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
