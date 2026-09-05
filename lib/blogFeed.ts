// lib/blogFeed.ts
//
// Every read of the blog: the public index and post page, and the admin list
// and editor. Public reads go through the anon client (RLS returns published
// rows only, and the page stays cacheable); admin reads go through the
// service-role client so drafts and author names are visible.
//
// TWO ACCESS PATTERNS, ONE ORDER — the same rule the browse lists follow. A
// `?page=N` arrival (a crawler, a shared link) has no row to continue from, so
// OFFSET answers it; "load more" holds the last row it saw, so a keyset cursor
// answers that without a row shifting under it between requests. published_at
// is not unique, so id is the tiebreaker that makes the key total.

import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/admin'
import { encodeCursor, decodeCursor } from '@/lib/cursor'
import { plainText, readingTimeMinutes } from '@/lib/markdown'
import type { PostStatus, PostAudience, PostLanguage } from '@/lib/blog'

export type BlogListItem = {
  id: string
  slug: string
  title: string
  cluster: string
  audience: PostAudience
  language: PostLanguage
  coverPath: string | null
  coverAlt: string | null
  excerpt: string
  readingTime: number
  publishedAt: string | null
}

export type BlogPost = {
  id: string
  slug: string
  title: string
  cluster: string
  audience: PostAudience
  language: PostLanguage
  body: string
  coverPath: string | null
  coverAlt: string | null
  seoTitle: string | null
  seoDescription: string | null
  relatedLandingPages: string[]
  /** Optional city / subject (display strings) for the composer and JSON-LD. */
  city: string | null
  subject: string | null
  publishedAt: string | null
  updatedAt: string
}

type PublicCursor = { p: string | null; id: string }

const EXCERPT_LEN = 160

function excerptOf(seoDescription: string | null, body: string): string {
  const base = (seoDescription ?? '').trim() || plainText(body)
  return base.length > EXCERPT_LEN ? `${base.slice(0, EXCERPT_LEN).trimEnd()}…` : base
}

// --------------------------------------------------------------- public ----

const PUBLIC_CARD_COLS =
  'id, slug, title, cluster, audience, language, cover_path, cover_alt, seo_description, body, published_at'

function toListItem(r: Record<string, unknown>): BlogListItem {
  const body = (r.body as string) ?? ''
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    cluster: r.cluster as string,
    audience: r.audience as PostAudience,
    language: r.language as PostLanguage,
    coverPath: (r.cover_path as string) ?? null,
    coverAlt: (r.cover_alt as string) ?? null,
    excerpt: excerptOf((r.seo_description as string) ?? null, body),
    readingTime: readingTimeMinutes(body),
    publishedAt: (r.published_at as string) ?? null,
  }
}

/**
 * A window of published posts, newest first. `cluster` filters to one cluster;
 * `offset` serves a cold `?page=N`; `cursor` serves load-more.
 */
export async function listPublishedPosts(args: {
  cluster?: string | null
  limit: number
  offset?: number
  cursor?: string | null
}): Promise<{ items: BlogListItem[]; total: number; nextCursor: string | null }> {
  const { cluster = null, limit, offset = 0, cursor = null } = args
  const db = createPublicClient()
  const after = decodeCursor<PublicCursor>(cursor)

  let q = db
    .from('posts')
    .select(PUBLIC_CARD_COLS)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cluster) q = q.eq('cluster', cluster)

  // Keyset: rows strictly after (published_at, id) in the descending order.
  if (after) {
    q = q.or(
      `published_at.lt.${after.p},and(published_at.eq.${after.p},id.lt.${after.id})`,
    )
  } else if (offset > 0) {
    q = q.range(offset, offset + limit - 1)
  }

  const { data } = await q

  // The total for the eligible set, taken independently of the window.
  let countQ = db.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published')
  if (cluster) countQ = countQ.eq('cluster', cluster)
  const { count } = await countQ
  const total = count ?? 0

  const items = (data ?? []).map(toListItem)
  // End when the page came back short (there is no next window), or — in the
  // offset case, where the absolute position is known — when the window
  // reaches the total.
  const last = items[items.length - 1]
  const nextCursor =
    items.length < limit || (!after && offset + items.length >= total)
      ? null
      : last
        ? encodeCursor({ p: last.publishedAt, id: last.id } satisfies PublicCursor)
        : null

  return { items, total, nextCursor }
}

/** One published post by slug, or null. */
export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  const db = createPublicClient()
  const { data } = await db
    .from('posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return data ? toPost(data) : null
}

function toPost(r: Record<string, unknown>): BlogPost {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    cluster: r.cluster as string,
    audience: r.audience as PostAudience,
    language: r.language as PostLanguage,
    body: (r.body as string) ?? '',
    coverPath: (r.cover_path as string) ?? null,
    coverAlt: (r.cover_alt as string) ?? null,
    seoTitle: (r.seo_title as string) ?? null,
    seoDescription: (r.seo_description as string) ?? null,
    relatedLandingPages: (r.related_landing_pages as string[]) ?? [],
    city: (r.city as string) ?? null,
    subject: (r.subject as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
    updatedAt: r.updated_at as string,
  }
}

/**
 * Whether a slug belongs to a post that exists but is NOT published — the
 * signal /blog/[slug] uses to answer 410 (Gone) rather than 404 for a post
 * that was unpublished. Reads through the service role, because an unpublished
 * row is invisible to the anon key by policy.
 */
export async function unpublishedPostExists(slug: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from('posts')
    .select('id, status')
    .eq('slug', slug)
    .maybeSingle()
  return !!data && data.status !== 'published'
}

/** Every published slug, for the sitemap. */
export async function publishedSlugs(): Promise<{ slug: string; updatedAt: string | null }[]> {
  const db = createPublicClient()
  const { data } = await db
    .from('posts')
    .select('slug, published_at, updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
  return (data ?? []).map((r) => ({
    slug: r.slug as string,
    updatedAt: (r.published_at as string) ?? (r.updated_at as string) ?? null,
  }))
}

/** Recent published posts in a cluster (or overall), for "related posts". */
export async function relatedPosts(args: {
  cluster: string
  excludeId: string
  limit: number
}): Promise<BlogListItem[]> {
  const db = createPublicClient()
  const { data } = await db
    .from('posts')
    .select(PUBLIC_CARD_COLS)
    .eq('status', 'published')
    .eq('cluster', args.cluster)
    .neq('id', args.excludeId)
    .order('published_at', { ascending: false })
    .limit(args.limit)
  return (data ?? []).map(toListItem)
}

// ---------------------------------------------------------------- admin ----

export type AdminPostRow = {
  id: string
  slug: string
  title: string
  cluster: string
  audience: PostAudience
  language: PostLanguage
  status: PostStatus
  authorName: string | null
  views: number
  ctaClicks: number
  publishAt: string | null
  updatedAt: string
}

type AdminCursor = { u: string; id: string }

/**
 * The admin list: every post including drafts, newest-edited first. Optional
 * text, cluster and status filters. Service role, because drafts and author
 * names are not public.
 */
export async function listAdminPosts(args: {
  q?: string | null
  cluster?: string | null
  status?: string | null
  limit: number
  cursor?: string | null
}): Promise<{ items: AdminPostRow[]; nextCursor: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { items: [], nextCursor: null }

  const after = decodeCursor<AdminCursor>(args.cursor ?? null)

  let q = admin
    .from('posts')
    .select(
      'id, slug, title, cluster, audience, language, status, views, cta_clicks, publish_at, updated_at, author:author_id(full_name)',
    )
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(args.limit)

  if (args.cluster) q = q.eq('cluster', args.cluster)
  if (args.status) q = q.eq('status', args.status)
  if (args.q && args.q.trim()) q = q.ilike('title', `%${args.q.trim()}%`)
  if (after) {
    q = q.or(`updated_at.lt.${after.u},and(updated_at.eq.${after.u},id.lt.${after.id})`)
  }

  const { data } = await q
  const rows = (data ?? []) as Record<string, unknown>[]

  const items: AdminPostRow[] = rows.map((r) => {
    const author = r.author as { full_name?: string } | { full_name?: string }[] | null
    const authorName = Array.isArray(author) ? author[0]?.full_name ?? null : author?.full_name ?? null
    return {
      id: r.id as string,
      slug: r.slug as string,
      title: r.title as string,
      cluster: r.cluster as string,
      audience: r.audience as PostAudience,
      language: r.language as PostLanguage,
      status: r.status as PostStatus,
      authorName,
      views: (r.views as number) ?? 0,
      ctaClicks: (r.cta_clicks as number) ?? 0,
      publishAt: (r.publish_at as string) ?? null,
      updatedAt: r.updated_at as string,
    }
  })

  const last = items[items.length - 1]
  const nextCursor =
    items.length < args.limit || !last
      ? null
      : encodeCursor({ u: last.updatedAt, id: last.id } satisfies AdminCursor)

  return { items, nextCursor }
}

/** The full row for the editor. Service role. */
export async function getAdminPost(id: string): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('posts').select('*').eq('id', id).maybeSingle()
  return data ?? null
}

/** Is this slug taken by a different post? For the editor's slug check. */
export async function slugTaken(slug: string, exceptId: string | null): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  let q = admin.from('posts').select('id').eq('slug', slug)
  if (exceptId) q = q.neq('id', exceptId)
  const { data } = await q.maybeSingle()
  return !!data
}
