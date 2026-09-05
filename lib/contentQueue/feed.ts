// lib/contentQueue/feed.ts
//
// Reading the content queue: the admin screen, the editor pre-fill, and the
// Monday digest. Server-only — all reads go through the service key, because
// the table is admin-read and the digest runs from the cron with no session.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { subjectMetaByMaster, citySegment } from '@/lib/landing'
import { CITIES } from '@/lib/locations'
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

/**
 * A suggestion enriched with the city and subject its fingerprint encodes, for
 * the "Start from a suggested title" panel in the editor — picking one fills
 * those post fields too. The search/coverage fingerprints carry a master id or
 * a subject slug and a city slug; calendar/report topics carry neither and
 * resolve to null, which the editor simply leaves blank.
 */
export type EditorSuggestion = Suggestion & { city: string | null; subject: string | null }

function cityFromSlug(slug: string): string {
  const match = CITIES.find((c) => citySegment(c) === slug)
  if (match) return match
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

/** The open content queue (suggested + snoozed) for the editor panel. */
export async function listEditorSuggestions(): Promise<EditorSuggestion[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('content_suggestions')
    .select('*')
    .eq('card', 'content')
    .in('status', ['suggested', 'snoozed'])
    .order('priority', { ascending: false })
    .limit(60)
  const rows = data ?? []
  if (rows.length === 0) return []

  const byMaster = await subjectMetaByMaster()
  const bySubjectSlug = new Map<string, string>()
  for (const m of byMaster.values()) bySubjectSlug.set(m.slug, m.name)

  return rows.map((r) => {
    const s = toSuggestion(r)
    let city: string | null = null
    let subject: string | null = null
    const fp = (r.fingerprint as string) ?? ''
    if (fp.startsWith('search:')) {
      // search:tutors:<masterId>:<citySlug>
      const parts = fp.split(':')
      const masterId = Number(parts[2])
      const citySlug = parts[3] ?? ''
      subject = byMaster.get(masterId)?.name ?? null
      if (citySlug) city = cityFromSlug(citySlug)
    } else if (fp.startsWith('coverage:')) {
      // coverage:tutors/<citySlug>/<subjectSlug>
      const path = fp.slice('coverage:'.length).split('/')
      const citySlug = path[1] ?? ''
      const subjectSlug = path[2] ?? ''
      subject = bySubjectSlug.get(subjectSlug) ?? null
      if (citySlug) city = cityFromSlug(citySlug)
    }
    return { ...s, city, subject }
  })
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
