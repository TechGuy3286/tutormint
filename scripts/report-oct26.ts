/**
 * scripts/report-oct26.ts — READ-ONLY numbers for the 26 Oct 2026 PR report:
 *   - the merge preview for the Hafiz Ikrama Ansari pair (ids only; nothing merged);
 *   - the count of open duplicate pairs;
 *   - Follow-ups → Parents To do / Followed up counts;
 *   - the AI assistants sign-up counts.
 * Never prints a phone, email, CNIC or account number.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-oct26.ts
 */
import { createAdminClient } from '../lib/supabase/admin'
import { previewMerge } from '../lib/memberMerge'
import { loadOpenDuplicatePairs } from '../lib/memberDuplicates'
import { loadParentFollowUps } from '../lib/parentFollowUps'
import { loadAiAssistantTotals } from '../lib/signupSources'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('no service role key')

  const { data: hafiz } = await admin.from('profiles').select('id, role, created_at').ilike('full_name', '%hafiz%ikrama%ansari%')
  console.log(`Hafiz Ikrama Ansari accounts: ${(hafiz ?? []).length}`)
  for (const r of hafiz ?? []) console.log(`  ${r.id} · ${r.role} · joined ${String(r.created_at).slice(0, 10)}`)
  if ((hafiz ?? []).length >= 2) {
    const [a, b] = hafiz!
    const p = await previewMerge(a.id as string, b.id as string, null, () => null)
    if (!p.ok) console.log(`  preview: ${p.error}`)
    else {
      console.log(`  suggested to keep: ${p.suggestedKeep}`)
      for (const s of [p.a, p.b])
        console.log(`  ${s.id}: completion ${s.completion}% · documents ${s.documents.count} (approved: ${s.documents.approved.join(', ') || 'none'}) · payments ${s.payments.approved} paid of ${s.payments.total} · applications ${s.applications} · tuitions ${s.tuitions}`)
      console.log(`  block: ${p.block ?? 'none'}`)
      for (const l of p.lines) console.log(`  moves: ${l}`)
      if (p.plan) {
        const byTable = new Map<string, string[]>()
        for (const op of p.plan.ops) byTable.set(op.table, [...(byTable.get(op.table) ?? []), String(Object.values(op.match).join('/'))])
        for (const [t, ids] of byTable) console.log(`  ${t}: ${ids.join(', ')}`)
      }
    }
  }

  const pairs = await loadOpenDuplicatePairs()
  console.log(`Open duplicate pairs: ${pairs.length}`)

  const { rows } = await loadParentFollowUps()
  const live = rows.filter((r) => !r.notInterested)
  const todo = live.filter((r) => r.state.tab === 'todo').length
  const sent = live.filter((r) => r.state.section === 'sent').length
  const noReply = live.filter((r) => r.state.section === 'no_reply').length
  const waiting = live.filter((r) => r.reason === 'waiting_forward').length
  const overdue = live.filter((r) => r.state.tab === 'todo' && r.state.overdue && !r.state.action).length
  const byReason = new Map<string, number>()
  for (const r of live) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1)
  console.log(`Parents: To do ${todo} (waiting on us ${waiting}, overdue ${overdue}) · Followed up ${sent} · No reply after 3 ${noReply} · Not interested ${rows.length - live.length}`)
  console.log(`  by situation: ${[...byReason].map(([k, n]) => `${k} ${n}`).join(', ')}`)

  const ai = await loadAiAssistantTotals()
  if (ai) {
    console.log(`AI assistants: sign-ups 7d ${ai.signups.last7} · 30d ${ai.signups.last30} · all ${ai.signups.all}; paid tutors 7d ${ai.paidTutors.last7} · 30d ${ai.paidTutors.last30} · all ${ai.paidTutors.all}`)
    for (const s of ai.sites) console.log(`  ${s.site}: ${s.signups.all} sign-ups, ${s.paidTutors.all} paid tutors`)
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
