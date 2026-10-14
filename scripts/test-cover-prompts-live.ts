// npm run test:coverprompts:live — READ-ONLY, against the live database
// (owner, 14 Oct 2026). Builds the cover prompt for EVERY published post from
// the same source as scripts/print-cover-prompts.ts and checks each one: no hex
// colour code and no word "hex" (an image model can paint a code onto the
// picture), at most 120 words, one paragraph, the colour names present.
// Skips when SUPABASE_DB_URL is not set.
//   npx tsx --env-file=.env.local --test scripts/test-cover-prompts-live.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hasHexCode, PROMPT_COLOURS } from '../lib/covers/prompt'
import { publishedPostPrompts } from './coverPromptPosts'

test('every published post gets a cover prompt with colour names and no hex code', { skip: !process.env.SUPABASE_DB_URL }, async () => {
  const posts = await publishedPostPrompts()
  assert.ok(posts.length > 0, 'there are published posts to check')
  for (const p of posts) {
    assert.ok(!hasHexCode(p.prompt), `/blog/${p.slug}: hex code or "hex"`)
    assert.ok(!/#[0-9a-f]/i.test(p.prompt), `/blog/${p.slug}: "#" followed by hex characters`)
    assert.ok(p.prompt.includes(PROMPT_COLOURS), `/blog/${p.slug}: colour names`)
    const words = p.prompt.split(/\s+/).length
    assert.ok(words <= 120, `/blog/${p.slug}: ${words} words`)
    assert.ok(!p.prompt.includes('\n'), `/blog/${p.slug}: one paragraph`)
    assert.ok(!p.prompt.includes(p.title), `/blog/${p.slug}: title pasted`)
  }
})
