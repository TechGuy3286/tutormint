/**
 * scripts/print-cover-prompts.ts — READ-ONLY. Prints the cover scene prompt for
 * every published post, built by the same rule the editor uses
 * (lib/covers/prompt coverImagePrompt), so the wording can be reviewed.
 *   npx tsx --env-file=.env.local scripts/print-cover-prompts.ts
 */
import { publishedPostPrompts } from './coverPromptPosts'

async function main() {
  for (const p of await publishedPostPrompts()) console.log(`\n/blog/${p.slug}\n${p.prompt}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
