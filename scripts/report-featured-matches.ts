/**
 * scripts/report-featured-matches.ts — PR-14. READ-ONLY on production.
 * What today's "Featured — matched tuitions" run would make (generateFeaturedItems
 * with dryRun: nothing written), and today's stored items. Counts only — never a
 * name, number or id.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-featured-matches.ts
 */
import { generateFeaturedItems, loadFeaturedQueue } from '@/lib/featuredMatches'

async function main() {
  const r = await generateFeaturedItems(Date.now(), { dryRun: true })
  console.log(`day ${r.day}: active tutor Featured plans ${r.featured} · not deliverable ${r.notDeliverable} · would make ${r.created} item(s) · skipped (no new match) ${r.skippedNone}`)
  const q = await loadFeaturedQueue()
  console.log(`stored today: ${q.length} item(s) · to send ${q.filter((x) => x.state === 'to_send').length} · sent ${q.filter((x) => x.state === 'sent').length}`)
  process.exit(0)
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
