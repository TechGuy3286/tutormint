/**
 * scripts/coverPromptPosts.ts — READ-ONLY. Every published post with the fields
 * the cover prompt is built from, and its prompt (lib/covers/prompt). The one
 * source for scripts/print-cover-prompts.ts and the live prompt test, so the
 * test checks exactly what the print shows.
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { coverImagePrompt } from '../lib/covers/prompt'

export type PromptPost = { slug: string; title: string; prompt: string }

export async function publishedPostPrompts(): Promise<PromptPost[]> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`select slug, title, cluster, city, subject, audience from posts where status = 'published' order by published_at`)
    return rows.map((p: { slug: string; title: string; cluster: string; city: string | null; subject: string | null; audience: 'parents' | 'tutors' | 'both' }) => ({
      slug: p.slug,
      title: p.title,
      prompt: coverImagePrompt({ title: p.title, cluster: p.cluster, city: p.city, subject: p.subject, audience: p.audience, slug: p.slug }),
    }))
  } finally {
    await c.end()
  }
}
