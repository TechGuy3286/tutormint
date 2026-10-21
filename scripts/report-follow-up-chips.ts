// scripts/report-follow-up-chips.ts — READ ONLY. Counts per chip on
// Follow-ups → Tutors (owner, 20 Oct 2026), per group, plus the started
// checkouts that are not tutors' (parents), which the Tutors list does not show.
// Prints counts only: never a name, phone number, email or CNIC.
//
//   npx tsx --conditions=react-server --env-file=.env.local scripts/report-follow-up-chips.ts

import { loadTutorFollowUps } from '../lib/tutorFollowUps'
import { loadStartedNotFinished } from '../lib/startedPayment'
import { chipCounts, FOLLOW_CHIP_LABEL, FOLLOW_CHIPS, type FollowChip } from '../lib/tutorFollowUpCore'
import { TUTOR_SCOPES, TUTOR_SCOPE_LABEL } from '../lib/staffOutreachCore'
import { loadAbandonedSignups } from '../lib/abandonedSignups'
import { loadDirectory } from '../lib/peopleDirectory'
import { loadNotInterested } from '../lib/followUpDismissals'
import { onParentsTab } from '../lib/followUpsPageCore'

async function main() {
  for (const scope of TUTOR_SCOPES) {
    const rows = await loadTutorFollowUps(scope)
    const counts = chipCounts(rows.map((r) => ({ chips: new Set<FollowChip>(r.chips) })))
    const primary = new Map<FollowChip, number>()
    for (const r of rows) primary.set(r.primary, (primary.get(r.primary) ?? 0) + 1)
    console.log(`\n${TUTOR_SCOPE_LABEL[scope]} — ${counts.all} tutors`)
    for (const c of FOLLOW_CHIPS) console.log(`  ${FOLLOW_CHIP_LABEL[c].padEnd(26)} ${String(counts[c]).padStart(4)}   (shown as this on All: ${primary.get(c) ?? 0})`)
    const withPayPro = rows.filter((r) => r.startedPayment?.provider === 'paypro').length
    if (counts.started) console.log(`  …of which PayPro checkouts (Check payment status): ${withPayPro}`)
  }
  const started = await loadStartedNotFinished()
  const tutorIds = new Set((await loadTutorFollowUps('recent')).filter((r) => r.startedPayment).map((r) => r.id))
  const notInList = started.filter((s) => s.userId && !tutorIds.has(s.userId)).length
  console.log(`\nStarted checkouts not on the Tutors list (parents or excluded accounts): ${notInList}`)
  // Parents tab (owner, 21 Oct 2026): the People rule, then Not interested.
  const [{ rows }, dir, ni] = await Promise.all([loadAbandonedSignups(), loadDirectory(), loadNotInterested()])
  const excluded = new Set(dir.people.filter((p) => p.excluded !== null).map((p) => p.id))
  const listed = rows.filter((r) => onParentsTab(r) && !excluded.has(r.userId))
  const live = listed.filter((r) => !ni.has(r.userId))
  const by = (stage: string) => live.filter((r) => r.stage === stage).length
  console.log(
    `\nParents — not finished ${live.length} (email not confirmed ${by('email_unconfirmed')}, profile unfinished ${by('profile_unfinished')}); not interested ${listed.length - live.length}`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
