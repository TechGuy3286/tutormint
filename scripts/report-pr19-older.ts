/**
 * scripts/report-pr19-older.ts — READ-ONLY on production; writes nothing.
 *
 * PR-19: how many applications the new Older rule (still at Applied more than
 * 14 days after they were made, with no follow-up) moves out of To do / Sent
 * into Older, and how many counted applications per date window the board
 * lists against the shared count. Prints counts only — never a name or id.
 *
 *   npx tsx --env-file=.env.local scripts/report-pr19-older.ts
 */
import { loadApplicationBoard } from '@/lib/applicationTracking'
import { isOlderTuition } from '@/lib/applicationStageCore'
import { isStaleApplied, sectionOf, dueState } from '@/lib/applicationFollowUpCore'
import { applicationDateCountsFresh } from '@/lib/counts'
import { COUNT_PERIODS } from '@/lib/countsCore'
import { inAppsDate } from '@/lib/applicationsPagingCore'

async function main() {
  const nowMs = Date.now()
  const board = await loadApplicationBoard()
  let moved = 0
  let movedFromTodo = 0
  let olderBefore = 0
  let olderNow = 0
  for (const r of board.rows) {
    const due = dueState(r, r.followUps, nowMs)
    const wasOlder = !r.unavailable && isOlderTuition(r.jobCreatedAt, nowMs)
    if (wasOlder) olderBefore++
    if (sectionOf(due) === 'older') olderNow++
    if (!wasOlder && !r.unavailable && isStaleApplied(r, r.followUps, nowMs)) {
      moved++
      if (due.tab === 'todo') movedFromTodo++
    }
  }
  console.log(`Board: ${board.rows.length} applications`)
  console.log(`Older before PR-19: ${olderBefore} · Older now: ${olderNow}`)
  console.log(`Moved to Older by the 14-day Applied rule: ${moved} (of them from To do: ${movedFromTodo})`)
  const shared = await applicationDateCountsFresh(nowMs)
  for (const p of COUNT_PERIODS) {
    const listed = board.rows.filter((r) => inAppsDate(r.createdAt, p.key, nowMs)).length
    console.log(`${p.label.padEnd(12)} shared count ${shared[p.key]} · on the board ${listed}`)
  }
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
