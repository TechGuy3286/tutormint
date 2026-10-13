/**
 * scripts/report-location-review.ts — read-only (owner, 13 Oct 2026).
 *
 * What Admin → Locations shows: the typed areas waiting for review and what is
 * suggested for each. Nothing is written and nothing is approved here.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-location-review.ts [--list]
 */
import { loadLocationReview } from '../lib/locationReview'
import { suggestionLine } from '../lib/locationCleanCore'

async function main() {
  const board = await loadLocationReview()
  const by = (a: string, c?: string) => board.rows.filter((r) => r.suggestion.action === a && (!c || r.suggestion.confidence === c)).length
  console.log(`typed areas to review: ${board.rows.length}`)
  console.log(`suggested "Same as existing area": ${by('same')} (sure ${by('same', 'high')} · likely ${by('same', 'medium')})`)
  console.log(`suggested "Not an area": ${by('not_area')}`)
  console.log(`suggested "Add as new area": ${by('add')}`)
  console.log(`already approved: ${board.counts.aliases} aliases · ${board.counts.ignored} not an area`)
  const want = ['harbnspura', 'liaqatbad', 'manwan', 'thokar naiz baig', 'valencia', 'azmir town', 'dha phase 5']
  for (const w of want) {
    const hit = board.rows.filter((r) => r.value.toLowerCase().includes(w))
    for (const r of hit.slice(0, 3)) console.log(`  "${r.value}" (${r.city || 'no city'}, used ${r.count}) → ${suggestionLine(r.suggestion)} [${r.suggestion.confidence}]`)
  }
  if (process.argv.includes('--list')) {
    for (const r of board.rows) console.log(`${r.count}\t${r.city || '—'}\t${r.value}\t${suggestionLine(r.suggestion)}\t${r.suggestion.confidence}`)
  }
}

void main().then(() => process.exit(0))
