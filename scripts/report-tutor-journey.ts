// scripts/report-tutor-journey.ts — READ ONLY. The numbers for the tutor
// journey PR (owner, 23 Oct 2026): Follow-ups → Tutors To do / Sent per group,
// Paid tutors (how many, how many red and why, per city owner), and the
// Activity-tab lines rebuilt from records, per event type, over every tutor
// and parent. Prints counts and staff names only — never a member's name,
// phone number, email or CNIC.
//
//   npx tsx --conditions=react-server --env-file=.env.local scripts/report-tutor-journey.ts

import { loadTutorFollowUps } from '../lib/tutorFollowUps'
import { TUTOR_SCOPES, TUTOR_SCOPE_LABEL } from '../lib/staffOutreachCore'
import { fuBadgeCount, tabCounts } from '../lib/tutorFollowUpTabsCore'
import { FOLLOW_REASON_LABEL, type FollowReason } from '../lib/followUpTemplatesCore'
import { loadPaidTutors } from '../lib/paidTutors'
import { loadJourney } from '../lib/journey'
import { JOURNEY_KIND_LABEL, countByKind, type JourneyKind } from '../lib/journeyCore'
import { loadDirectory } from '../lib/peopleDirectory'

async function main() {
  console.log('Follow-ups → Tutors')
  for (const scope of TUTOR_SCOPES) {
    const rows = await loadTutorFollowUps(scope)
    const c = tabCounts(rows.map((r) => r.state))
    console.log(`  ${TUTOR_SCOPE_LABEL[scope].padEnd(24)} To do ${c.todo}  ·  Sent ${c.sent} (no reply after 3: ${c.noReply})`)
  }
  const open = await loadTutorFollowUps('open')
  const reasons = new Map<FollowReason, number>()
  for (const r of open) reasons.set(r.followReason, (reasons.get(r.followReason) ?? 0) + 1)
  console.log(`  every group (not "Not interested"): ${open.length}; badge (overdue To do): ${fuBadgeCount(open.map((r) => r.state))}`)
  for (const [k, n] of reasons) console.log(`    ${FOLLOW_REASON_LABEL[k].padEnd(36)} ${n}`)

  const { rows, staff } = await loadPaidTutors()
  const name = new Map(staff.map((s) => [s.id, s.name]))
  const red = rows.filter((r) => r.red.length)
  console.log(`\nPaid tutors: ${rows.length}, red ${red.length}`)
  console.log(`  waiting to forward over 1 day: ${red.filter((r) => r.red.includes('waiting_to_forward')).length}`)
  console.log(`  not contacted for 7 days:      ${red.filter((r) => r.red.includes('no_contact')).length}`)
  console.log(`  profile not finished:          ${rows.filter((r) => !r.profileFinished).length}`)
  const byOwner = new Map<string, { all: number; red: number; wait: number; contact: number }>()
  for (const r of rows) {
    const k = r.ownerId ? (name.get(r.ownerId) ?? 'Unknown') : 'No owner'
    const o = byOwner.get(k) ?? { all: 0, red: 0, wait: 0, contact: 0 }
    o.all++
    if (r.red.length) o.red++
    if (r.red.includes('waiting_to_forward')) o.wait++
    if (r.red.includes('no_contact')) o.contact++
    byOwner.set(k, o)
  }
  for (const [k, o] of byOwner) console.log(`  ${k.padEnd(20)} ${o.all} paid · ${o.red} red (${o.wait} waiting to forward, ${o.contact} no contact)`)

  const dir = await loadDirectory()
  const members = dir.people.filter((p) => p.excluded === null)
  const total: Partial<Record<JourneyKind, number>> = {}
  let n = 0
  for (let i = 0; i < members.length; i += 8) {
    const part = await Promise.all(members.slice(i, i + 8).map((m) => loadJourney(m.id)))
    for (const j of part) {
      if (!j) continue
      n++
      for (const [k, v] of Object.entries(countByKind(j.lines))) total[k as JourneyKind] = (total[k as JourneyKind] ?? 0) + (v ?? 0)
    }
  }
  console.log(`\nActivity tab — lines rebuilt from records, over ${n} tutors and parents:`)
  for (const [k, v] of Object.entries(total).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) console.log(`  ${JOURNEY_KIND_LABEL[k as JourneyKind].padEnd(26)} ${v}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
