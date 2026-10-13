/**
 * scripts/report-content-queue.ts — read-only (owner, 13 Oct 2026).
 * The visible "Start from a suggested title" queue, its mix, and why other
 * suggestions left it. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-content-queue.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { hasRawLabel } from '../lib/contentQueue/topics'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = (await c.query(
    `select title, cluster, audience, language, priority, evidence_key from content_suggestions where card = 'content' and status = 'suggested' order by priority desc, title`,
  )) as { rows: { title: string; cluster: string | null; language: string; priority: number; evidence_key: Record<string, unknown> | null }[] }
  const career = rows.filter((r) => r.cluster === 'tutor-career').length
  console.log(`visible: ${rows.length} · tutor career ${career} (${rows.length ? Math.round((career / rows.length) * 100) : 0}%)`)
  const by = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
  }
  console.log('by cluster:', by((r) => r.cluster ?? '—'))
  console.log('by city:', by((r) => String(r.evidence_key?.city ?? '(no city)')))
  console.log('titles with a raw label:', rows.filter((r) => hasRawLabel(r.title)).map((r) => r.title).join(' | ') || 'none')
  const posts = (await c.query(`select title from posts where status <> 'unpublished'`)).rows as { title: string }[]
  const same = rows.filter((r) => posts.some((p) => p.title.toLowerCase() === r.title.toLowerCase()))
  console.log('titles that are an existing post:', same.map((r) => r.title).join(' | ') || 'none')
  for (const r of rows) console.log(`  [${r.cluster}] ${r.title}`)
  const gone = (await c.query(`select dismiss_reason, title from content_suggestions where status = 'dismissed' and (dismiss_reason like 'already covered%' or dismiss_reason like 'auto:%') order by dismiss_reason, title`)).rows as { dismiss_reason: string; title: string }[]
  console.log(`\ndismissed by the queue itself: ${gone.length}`)
  for (const g of gone) console.log(`  ${g.title}  ←  ${g.dismiss_reason.slice(0, 90)}`)
  await c.end()
}

void main()
