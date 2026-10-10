/**
 * scripts/report-applicant-forwards.ts — READ-ONLY.
 * The live numbers behind Marketplace → Applicants to forward
 * (lib/applicantForwards, the same loader the screen uses): tuitions in each
 * tab, paid tutors involved, applications and number views counted. Prints no
 * name and no phone number.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-applicant-forwards.ts
 */
import { loadForwardBoard } from '../lib/applicantForwards'
import { buildForwardMessage } from '../lib/applicantForwardCore'

async function main() {
  const board = await loadForwardBoard()
  const c = board.counts
  console.log(`To forward: ${c.toForward} tuitions · Forwarded: ${c.forwarded} · Outcome: ${c.outcome}`)
  console.log(`paid tutors involved: ${c.paidTutors} (in To forward: ${c.paidTutorsToForward})`)
  console.log(`counted: ${c.applications} applications + ${c.views} number views = ${c.applications + c.views}`)
  const cards = board.cards
  console.log(`cards: ${cards.length} · with a parent number: ${cards.filter((x) => x.parent.msisdn).length} · with a parent name: ${cards.filter((x) => x.parent.name).length}`)
  const byStatus: Record<string, number> = {}
  for (const x of cards) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1
  console.log('tuition status:', JSON.stringify(byStatus))
  console.log(`tutors per card: max ${Math.max(0, ...cards.map((x) => x.tutors.length))} · tutors with a public profile link: ${cards.flatMap((x) => x.tutors).filter((t) => t.profileUrl).length} of ${cards.flatMap((x) => x.tutors).length}`)
  // Every prefilled message is complete and number-free.
  let bad = 0
  for (const x of cards) {
    const msg = buildForwardMessage({ template: board.template, parentName: x.parent.name, tuitionTitle: x.title, area: x.place || x.area, tutors: x.tutors.map((t) => ({ name: t.name, profileUrl: t.profileUrl })) })
    if (/\{[a-z_]+\}/.test(msg) || /\d{7,}/.test(msg.replace(/https?:\/\/\S+/g, ''))) bad++
  }
  console.log(`messages with an unfilled placeholder or a number-like run: ${bad}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
