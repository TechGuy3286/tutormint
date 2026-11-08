/**
 * scripts/report-pipeline-counts.ts — READ-ONLY.
 *
 * Owner, 8 Nov 2026: the People → Tutors pipeline as stored by the summary
 * job — how many real tutors are in each stage, and Not followed up / Followed
 * up for the stages that are followed up. Counts only: no names, phones or
 * emails. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-pipeline-counts.ts
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: state } = await admin.from('admin_summary').select('payload').eq('key', 'state').maybeSingle()
  console.log('summary built at:', (state?.payload as { builtAt?: string } | null)?.builtAt ?? '—')
  const tags: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('admin_list_rows').select('tags').eq('list', 'people:tutor').order('member_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    tags.push(...(data ?? []).map((r) => r.tags as Record<string, unknown>))
    if (!data || data.length < 1000) break
  }
  const real = tags.filter((t) => t.excluded === false)
  const live = real.filter((t) => t.ni !== true)
  console.log('stored tutor rows:', tags.length, '· real:', real.length, '· with a stage tag:', real.filter((t) => typeof t.stage === 'string').length)
  console.log('deleted:', tags.filter((t) => t.deleted === true).length, '· not interested (real):', real.filter((t) => t.ni === true).length)
  const by: Record<string, { all: number; not: number; done: number }> = {}
  for (const t of live) {
    const s = String(t.stage ?? '(none)')
    by[s] ??= { all: 0, not: 0, done: 0 }
    by[s].all++
    if (t.fu === 'not') by[s].not++
    if (t.fu === 'done') by[s].done++
  }
  for (const s of ['missing', 'waiting', 'rejected', 'approved', 'paid', '(none)']) if (by[s]) console.log(s.padEnd(10), JSON.stringify(by[s]))
  console.log('rejected, not informed:', live.filter((t) => t.stage === 'rejected' && t.informed !== true).length)
  const { data: b } = await admin.from('admin_summary').select('payload').eq('key', 'badges').maybeSingle()
  const bp = (b?.payload ?? {}) as Record<string, unknown>
  console.log('badge parts — peopleWaiting:', bp.peopleWaiting, '· pipelineDue:', bp.pipelineDue, '· parentOverdue:', bp.parentOverdue)
  const { data: ov } = await admin.from('admin_summary').select('payload').eq('key', 'overview:7').maybeSingle()
  const p = (ov?.payload ?? {}) as Record<string, { count?: number }>
  console.log('overview — todo-docs:', p['todo-docs']?.count, '· todo-fee-pending:', p['todo-fee-pending']?.count, '· todo-rejected-uninformed:', p['todo-rejected-uninformed']?.count)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
