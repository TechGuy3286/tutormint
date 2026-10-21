// Read-only: the People page's counts per tab and chip, the accounts left out
// by default (name and reason only), the duplicate tag count, and the sidebar
// badge. Never prints an email, mobile or CNIC.
//
//   npx tsx --conditions=react-server --env-file=.env.local scripts/report-people-tabs.ts

import { directoryCounts, duplicateTags, inTab, loadDirectory, loadDirectoryDocs, peopleWaitingCount } from '@/lib/peopleDirectory'
import { DUP_WORDS, EXCLUDE_WORDS, duplicateCount, paidTag, postedTag } from '@/lib/peopleDirectoryCore'
import { docFilterCounts } from '@/lib/tutorDocSummaryCore'

async function main() {
  const d = await loadDirectory()
  const counts = await directoryCounts()
  console.log('Tabs:', counts)

  const tutors = inTab(d.people, 'tutor', false)
  const docs = await loadDirectoryDocs()
  const paid = tutors.filter((t) => paidTag(t.feePaidAt) === 'paid').length
  console.log(`Tutors: paid ${paid}, unpaid ${tutors.length - paid}`)
  for (const [label, set] of [['all', tutors], ['paid', tutors.filter((t) => t.feePaidAt)], ['unpaid', tutors.filter((t) => !t.feePaidAt)]] as const) {
    console.log(`  docs chips (${label}):`, docFilterCounts(set.map((t) => ({ docs: docs.get(t.id) ? { kind: docs.get(t.id)!.kind, oldestUploadAt: null } : null }))))
  }
  console.log(`  videos waiting: ${tutors.filter((t) => t.videoWaiting).length}`)

  const parents = inTab(d.people, 'parent', false)
  const posted = parents.filter((p) => postedTag(p.parent?.tuitionsTotal ?? 0) === 'posted').length
  console.log(`Parents: posted ${posted}, not posted ${parents.length - posted}`)
  const pv: Record<string, number> = {}
  for (const p of parents) pv[p.parent!.verification] = (pv[p.parent!.verification] ?? 0) + 1
  console.log('  verification chips:', pv)

  console.log('\nLeft out by default:')
  for (const p of d.people.filter((x) => x.excluded)) console.log(`  ${p.role} · ${p.name} · ${EXCLUDE_WORDS[p.excluded!]}`)

  const shown = d.people.filter((p) => p.excluded === null)
  const tags = await duplicateTags(shown)
  console.log(`\nPossible duplicates (default view): ${duplicateCount(tags)} members tagged`)
  for (const [id, links] of tags) {
    const me = shown.find((p) => p.id === id)
    console.log(`  ${me?.role} · ${me?.name} ↔ ${links.map((l) => `${l.name} (${DUP_WORDS[l.reason]})`).join(', ')}`)
  }

  console.log(`\nPeople badge (documents waiting): ${await peopleWaitingCount()}`)
  console.log(`Staff: ${d.staff.length}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
