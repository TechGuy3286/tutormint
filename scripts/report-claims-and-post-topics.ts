/**
 * scripts/report-claims-and-post-topics.ts — READ-ONLY (owner, 14 Oct 2026).
 *
 *   npx tsx --env-file=.env.local scripts/report-claims-and-post-topics.ts
 *
 * 1. Every published post's computed topic — city, level group(s) and subject —
 *    by the one rule the post page uses (lib/blogRelevanceCore postTopic).
 * 2. Where a superlative about TutorMint ("largest", "biggest", "No.1", "#1",
 *    "most trusted", "leading", "best tutor…", "top-rated") is STORED: message
 *    templates, posts, advertisements, app settings, plans, the content queue.
 *    English and Urdu are listed separately; nothing is changed.
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { postTopic } from '../lib/blogRelevanceCore'

const EN = '(largest|biggest|no\\.?\\s*1\\M|number one|#\\s*1\\M|most[ -]trusted|\\mleading\\M|top[ -]rated|\\mbest (tutor|tutors|platform|network|site|website|app)\\M)'
const UR = '(سب سے بڑ|نمبر ون|نمبر 1|نمبر ایک|بہترین|سب سے زیادہ قابل)'

const TARGETS: { table: string; key: string; cols: string[] }[] = [
  { table: 'admin_message_templates', key: 'key', cols: ['title', 'subject', 'body'] },
  { table: 'posts', key: 'slug', cols: ['title', 'body', 'seo_title', 'seo_description', 'cover_alt'] },
  { table: 'advertisements', key: 'id', cols: ['title', 'description'] },
  { table: 'app_settings', key: 'key', cols: ['value'] },
  { table: 'plans', key: 'code', cols: ['name', 'tag_label', 'displayed_quota'] },
  { table: 'content_suggestions', key: 'id', cols: ['title'] },
]

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows: posts } = await c.query(
    `select slug, title, city, subject, cluster from posts where status = 'published' order by published_at`,
  )
  console.log(`\n== Published posts: computed topic (${posts.length}) ==`)
  for (const p of posts as { slug: string; title: string; city: string | null; subject: string | null; cluster: string }[]) {
    const t = postTopic(p)
    console.log(`/blog/${p.slug}\n   title: ${p.title}\n   fields: city=${p.city ?? '—'} · subject=${p.subject ?? '—'} · cluster=${p.cluster}\n   computed: city=${t.city || '—'} · level=${t.groups.join(' + ') || '—'} · subject=${t.subjects[0] ?? '—'}`)
  }

  const { rows: have } = await c.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)
  const exists = new Set((have as { table_name: string; column_name: string }[]).map((r) => `${r.table_name}.${r.column_name}`))
  for (const [label, pattern] of [['English', EN], ['Urdu', UR]] as const) {
    console.log(`\n== Stored ${label} superlatives ==`)
    let any = false
    for (const t of TARGETS) {
      for (const col of t.cols) {
        if (!exists.has(`${t.table}.${col}`)) continue
        const { rows } = await c.query(
          `select "${t.key}"::text as k, substring("${col}"::text from '.{0,60}' || $1 || '.{0,60}') as hit from public."${t.table}" where "${col}"::text ~* $1`,
          [pattern],
        )
        for (const r of rows as { k: string; hit: string }[]) {
          any = true
          console.log(`${t.table}.${col} [${r.k}]: …${(r.hit ?? '').replace(/\s+/g, ' ')}…`)
        }
      }
    }
    if (!any) console.log('none')
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
