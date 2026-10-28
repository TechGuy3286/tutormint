/**
 * scripts/shots/review-board.ts — builds the Review new wording board from a
 * live-template dump on an in-memory database (nothing is written anywhere),
 * for a screenshot of the page.
 *
 *   npx tsx --conditions=react-server scripts/shots/review-board.ts <live.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadReviewBoard } from '@/lib/templateReview'
import { fakeSupabase } from '../fakeSupabase'

async function main() {
  const [livePath, out] = process.argv.slice(2)
  const live = JSON.parse(readFileSync(livePath, 'utf8'))
  const { client } = fakeSupabase({ admin_message_templates: live, app_settings: [{ key: 'support.whatsapp', value: '923215872222' }] })
  const board = await loadReviewBoard(client)
  writeFileSync(out, JSON.stringify(board))
  console.log(`${board.items.length} items`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
