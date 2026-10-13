import 'server-only'

import { unstable_cache } from 'next/cache'

import { pageAll, pageAllIn } from '@/lib/pageAll'
import { createPublicClient } from '@/lib/supabase/public'
import { LANDING_TAG, liveLandingPages, subjectMetaByMaster } from '@/lib/landing'
import { liveOverlapNoindex } from '@/lib/landingOverlap'
import {
  matchingTutorSlugs,
  postTopic,
  rankRelatedPosts,
  relevantItems,
  sameLevel,
  sameSubject,
  type PostTopic,
  type RankedItem,
  type TutorForPost,
} from '@/lib/blogRelevanceCore'

// The live data behind "what is related to this post" (owner, 13 Oct 2026).
// The rule itself is pure (lib/blogRelevanceCore); this file only loads what it
// is applied to: the INDEXABLE landing pages, the indexable tutors with what
// they teach, and the other published posts.

export type LandingItem = {
  /** "tutors/lahore/grade-4-islamiat-islamic-studies" — no leading slash. */
  path: string
  kind: 'tutors' | 'tuitions'
  city: string
  /** "Grade 4 Islamiat / Islamic Studies". */
  name: string
  level: string
  subject: string | null
  count: number
}

/**
 * Every landing page a post may show or link: at or above its threshold AND not
 * the narrower half of a near-duplicate pair — the same two conditions the page
 * uses for its own robots tag. Cached with the landing set.
 */
export const indexableLandingItems = unstable_cache(
  async (): Promise<LandingItem[]> => {
    const [pages, overlap] = await Promise.all([
      liveLandingPages(),
      liveOverlapNoindex().catch(() => new Map<string, unknown>()),
    ])
    return pages
      .filter((p) => !overlap.has(`${p.kind}/${p.citySlug}/${p.masterId}`))
      .map((p) => ({
        path: `${p.kind}/${p.citySlug}/${p.subjectSlug}`,
        kind: p.kind,
        city: p.city,
        name: p.subjectName,
        level: p.levelName ?? '',
        subject: p.subjectOnly ?? null,
        count: p.count,
      }))
  },
  ['blog-indexable-landing-v1'],
  { revalidate: 60 * 60 * 3, tags: [LANDING_TAG] },
)

type PostRef = { city?: string | null; subject?: string | null; title?: string | null }

/** The landing pages for a post's "Browse verified listings" box. The author's
 *  own picks come first within a tier, but an unrelated pick is never shown. */
export async function landingForPost(post: PostRef, picked: string[] = [], limit = 6): Promise<RankedItem<LandingItem>[]> {
  const items = await indexableLandingItems().catch(() => [] as LandingItem[])
  const preferred = new Set(picked.map((p) => p.replace(/^\//, '')))
  return relevantItems(items, postTopic(post), { limit, preferred, closestOnly: true })
}

/** The taxonomy rows a post is about, for matching tuitions. */
export async function mastersForTopic(topic: PostTopic): Promise<{ both: number[]; subject: number[]; levelNames: string[] }> {
  const byMaster = await subjectMetaByMaster()
  const both: number[] = []
  const subject: number[] = []
  const levelNames = new Set<string>()
  for (const m of byMaster.values()) {
    const s = sameSubject(topic, m.subject)
    const l = sameLevel(topic, m.level)
    if (s) subject.push(m.masterId)
    if (s && l) both.push(m.masterId)
    if (l) levelNames.add(m.level)
  }
  return { both, subject, levelNames: [...levelNames] }
}

/**
 * The indexable tutors (the sitemap's own list) with their city and what they
 * teach — what "may the writer name this tutor?" is decided on.
 */
export const indexableTutorsForPosts = unstable_cache(
  async (): Promise<(TutorForPost & { name: string })[]> => {
    const db = createPublicClient()
    const rows = await pageAll((from, to) => db.rpc('listed_tutor_slugs').order('slug').range(from, to))
    const slugs = ((rows ?? []) as { slug: string }[]).map((r) => r.slug).filter(Boolean)
    if (slugs.length === 0) return []
    const tutors = await pageAllIn(slugs, (part, from, to) =>
      db.from('tutor_directory').select('id, slug, full_name, city').in('slug', part).order('id').range(from, to),
    )
    const links = await pageAllIn(
      tutors.map((t) => t.id as string),
      (ids, from, to) => db.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', ids).order('tutor_id').order('master_id').range(from, to),
    )
    const byMaster = await subjectMetaByMaster()
    const subjectsOf = new Map<string, { level: string; subject: string | null }[]>()
    for (const l of links) {
      const meta = byMaster.get(l.master_id as number)
      if (!meta) continue
      const list = subjectsOf.get(l.tutor_id as string) ?? subjectsOf.set(l.tutor_id as string, []).get(l.tutor_id as string)!
      list.push({ level: meta.level, subject: meta.subject })
    }
    return tutors.map((t) => ({
      slug: t.slug as string,
      name: ((t.full_name as string | null) ?? '').trim() || (t.slug as string),
      city: (t.city as string | null) ?? null,
      subjects: subjectsOf.get(t.id as string) ?? [],
    }))
  },
  ['blog-indexable-tutors-v1'],
  { revalidate: 60 * 30, tags: [LANDING_TAG] },
)

/** The indexable tutors a post about this topic may name or link. */
export async function tutorsForPost(post: PostRef): Promise<{ slug: string; name: string }[]> {
  const all = await indexableTutorsForPosts().catch(() => [])
  const ok = new Set(matchingTutorSlugs(postTopic(post), all))
  return all.filter((t) => ok.has(t.slug)).map((t) => ({ slug: t.slug, name: t.name }))
}

export type RelatedPostRow = Record<string, unknown>

/** "Related reading" rows for a post: same subject, then level, city, cluster. */
export async function relatedPostRows(
  current: { id: string; city: string | null; subject: string | null; title: string; cluster: string },
  columns: string,
  limit = 3,
): Promise<RelatedPostRow[]> {
  const db = createPublicClient()
  const { data } = await db
    .from('posts')
    .select(`${columns}, city, subject`)
    .eq('status', 'published')
    .neq('id', current.id)
    .order('published_at', { ascending: false })
    .limit(200)
  const rows = ((data ?? []) as unknown as RelatedPostRow[]).map((r) => ({
    r,
    id: r.id as string,
    city: (r.city as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    cluster: (r.cluster as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
  }))
  return rankRelatedPosts(current, rows, limit).map((x) => x.r)
}
