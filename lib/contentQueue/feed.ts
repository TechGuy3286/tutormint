// lib/contentQueue/feed.ts
//
// Reading the content queue: the admin screen, the editor pre-fill, and the
// Monday digest. Server-only — all reads go through the service key, because
// the table is admin-read and the digest runs from the cron with no session.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Audience, Language, SuggestionCard, SuggestionSource, PriorityComponents } from './core'

export type Suggestion = {
  id: string
  card: SuggestionCard
  source: SuggestionSource
  title: string
  cluster: string | null
  audience: Audience
  language: Language
  priority: number
  components: PriorityComponents
  evidence: string[]
  status: string
  notes: string
  createdAt: string
}

function toSuggestion(r: Record<string, unknown>): Suggestion {
  return {
    id: r.id as string,
    card: (r.card as SuggestionCard) ?? 'content',
    source: r.source as SuggestionSource,
    title: (r.title as string) ?? '',
    cluster: (r.cluster as string) ?? null,
    audience: (r.audience as Audience) ?? 'both',
    language: (r.language as Language) ?? 'en',
    priority: Number(r.priority ?? 0),
    components: (r.priority_components as PriorityComponents) ?? { demand: 0, rankProximity: 1, seasonality: 1, gapAge: 1 },
    evidence: (r.evidence as string[]) ?? [],
    status: (r.status as string) ?? 'suggested',
    notes: (r.notes as string) ?? '',
    createdAt: (r.first_seen_at as string) ?? '',
  }
}

/** The live queue: suggested items only, highest priority first. */
export async function listSuggestions(): Promise<{ content: Suggestion[]; recruitment: Suggestion[] }> {
  const admin = createAdminClient()
  if (!admin) return { content: [], recruitment: [] }
  const { data } = await admin
    .from('content_suggestions')
    .select('*')
    .eq('status', 'suggested')
    .order('priority', { ascending: false })
    .limit(200)
  const all = (data ?? []).map(toSuggestion)
  return {
    content: all.filter((s) => s.card === 'content'),
    recruitment: all.filter((s) => s.card === 'recruitment'),
  }
}

/** One suggestion, for the editor pre-fill. */
export async function getSuggestion(id: string): Promise<Suggestion | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('content_suggestions').select('*').eq('id', id).maybeSingle()
  return data ? toSuggestion(data) : null
}

/** Published posts last touched 12+ months ago — due a refresh. */
export async function postsDueForRefresh(limit = 10): Promise<{ id: string; title: string; slug: string; publishedAt: string }[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString()
  const { data } = await admin
    .from('posts')
    .select('id, title, slug, published_at')
    .eq('status', 'published')
    .lte('published_at', cutoff)
    .order('published_at', { ascending: true })
    .limit(limit)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    publishedAt: r.published_at as string,
  }))
}
