/**
 * scripts/report-mudasir-merge-preview.ts — READ ONLY (owner, 27 Oct 2026).
 * Runs the real merge loader + planner (lib/memberMerge loadMergeSide,
 * lib/memberMergeCore planMerge) for Mudasir Hussain's parent and tutor
 * accounts and prints the block (if any), the preview lines and the ops'
 * tables/labels/row ids — never a value. Writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-mudasir-merge-preview.ts
 */
import { createAdminClient } from '../lib/supabase/admin'
import { loadMergeSide } from '../lib/memberMerge'
import { mergeBlock, planMerge, previewLines, suggestKeep } from '../lib/memberMergeCore'

const PARENT = 'd7a1b74a-1e11-423d-90c1-1e8240e5228a'
const TUTOR = 'd9c37f51-a6fc-4ba6-87ab-95e345e2decb'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('no service-role client')
  const [p, t] = await Promise.all([loadMergeSide(admin, PARENT), loadMergeSide(admin, TUTOR)])
  if (!p || !t) throw new Error('account missing')
  for (const s of [t, p])
    console.log(s.id, s.role, s.name, '| completion', s.completion, '| approved', s.approvedDocs.join(', ') || 'none', '| documents', s.documents.map((d) => d.kind).join(', '),
      '| jobs', s.jobs.length, '| children', (s.children ?? []).length, '| apps', s.applications.length, '| payments', s.payments.length, '| credit', s.credit ? 'yes' : 'no',
      '| address on file', !!(s.addressColumns?.address), '| address status', s.addressColumns?.address_status ?? null)
  console.log('suggested keep:', suggestKeep(p, t) === TUTOR ? 'the tutor account' : 'the parent account')
  const block = mergeBlock(t, p)
  console.log('block:', block ?? 'none')
  if (block) return
  const plan = planMerge(t, p, new Date().toISOString())
  console.log('\nPreview lines:')
  for (const l of previewLines(plan)) console.log('  -', l)
  console.log('\nOps (table · label · columns):')
  for (const o of plan.ops) console.log('  ', o.table, '·', o.label, '·', Object.keys(o.set).join(', '))
}
main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/\d{5,}/g, '<digits>'))
  process.exit(1)
})
