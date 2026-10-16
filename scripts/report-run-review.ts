/**
 * scripts/report-run-review.ts — READ ONLY (owner, 16 Oct 2026). The "Review
 * added areas" board in numbers: how many of the 120 areas the 16 Oct run
 * added carry a warning (with examples), how many have a public hub page, and
 * the My sign-ups rows per staff member by step.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-run-review.ts
 */
import { loadRunReview } from '../lib/locationRunReview'
import { WARNING_LABEL, type AreaWarning } from '../lib/locationRunCore'

async function main() {
  const b = await loadRunReview()
  console.log('summary', b.summary)
  const by = new Map<AreaWarning, string[]>()
  for (const a of b.areas) for (const w of a.warnings) by.set(w, [...(by.get(w) ?? []), `${a.name} (${a.city})${w === 'close_spelling' && a.closeTo ? ` ~ ${a.closeTo.name}` : ''}`])
  for (const [w, list] of by) console.log(`${WARNING_LABEL[w]}: ${list.length} — ${list.slice(0, 8).join('; ')}`)
  console.log('with hub:', b.areas.filter((a) => a.hub).map((a) => `${a.name} ${a.hub} (${a.openTuitions} open)`).join('; ') || 'none')
  console.log('unused (0 tuitions, 0 profiles):', b.areas.filter((a) => a.tuitions + a.profiles === 0).length)
  console.log('aliases: unused', b.aliases.filter((a) => a.uses === 0).length, '· ignored: unused', b.ignored.filter((a) => a.uses === 0).length)
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
