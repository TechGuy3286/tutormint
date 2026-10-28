// lib/contentQueue/digestCore.ts
//
// The weekly content email (owner, 28 Oct 2026), pure for the tests: three
// topics, each with "N searches last month" and one plain line on why. Topics
// from real Google searches first (uncovered, still open in the queue), then
// searches made on TutorMint itself. No priority number, ever.

import { searchesLine, whyLine, type SearchTopic } from './searchTopics'

export const DIGEST_TOPICS = 3

export type DigestItem = { title: string; searches: number; why: string; href: string }

/** An open queue topic built from searches on TutorMint (evidence_key.searches). */
export type SiteSearchTopic = { title: string; searches: number; audience: string }

export function digestItems(google: Pick<SearchTopic, 'title' | 'impressions' | 'side' | 'coveredBy'>[], site: SiteSearchTopic[]): DigestItem[] {
  const out: DigestItem[] = []
  for (const t of google) {
    if (out.length >= DIGEST_TOPICS) break
    if (t.coveredBy || t.impressions <= 0) continue
    out.push({ title: t.title, searches: t.impressions, why: whyLine(t), href: '/admin/blog/queue' })
  }
  for (const t of [...site].sort((a, b) => b.searches - a.searches)) {
    if (out.length >= DIGEST_TOPICS) break
    if (t.searches <= 0 || out.some((o) => o.title === t.title)) continue
    out.push({
      title: t.title,
      searches: t.searches,
      why: `${t.audience === 'tutors' ? 'Tutors' : 'Parents'} search for this on TutorMint and no post answers it yet.`,
      href: '/admin/blog/queue',
    })
  }
  return out
}

/** The email body lines. */
export function digestLines(items: { title: string; searches: number; why: string }[], refresh: { title: string }[]): string[] {
  const lines: string[] = []
  if (items.length > 0) {
    lines.push('Topics to write about this week:')
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   ${searchesLine(it.searches)}. ${it.why}`)
    })
  } else {
    lines.push('No new topics from searches this week.')
  }
  if (refresh.length > 0) {
    lines.push('')
    lines.push('Posts due a refresh (published over a year ago):')
    refresh.forEach((r) => lines.push(`• ${r.title}`))
  }
  return lines
}
