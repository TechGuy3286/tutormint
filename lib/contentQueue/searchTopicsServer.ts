// lib/contentQueue/searchTopicsServer.ts
//
// Reading and storing the Search Console query data the content queue is built
// from (owner, 28 Oct 2026), and the context the pure rules in ./searchTopics
// need (cities, areas, the pages and posts that already answer a search).
//
// Two sources, one table (search_console_queries, migration 213):
//   'api'    — read by the nightly rebuild with the Indexing service account
//              (read-only Search Console scope). On a failure the error is
//              stored and the earlier rows are kept.
//   'upload' — a "Queries" CSV the owner uploaded on the Content queue.
// The API wins when its last read worked and returned rows; otherwise the
// upload. Query, clicks and impressions only. Nothing here logs a key.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { indexingClientEmail } from '@/lib/googleIndexing'
import { cityPages, curatedAreasByCity, CITY_PAGE_THRESHOLD } from '@/lib/cityJobs'
import { liveLandingPagesUncached } from '@/lib/landing'
import { fetchSearchConsoleQueries, searchConsoleConfigured } from './gsc'
import {
  buildSearchTopics,
  gscAccessProblem,
  normaliseQuery,
  type CoverPage,
  type CoverPost,
  type QueryRow,
  type SearchTopic,
  type TopicContext,
} from './searchTopics'

export type SourceRow = { rows: QueryRow[]; status: 'ok' | 'error'; error: string | null; fetchedAt: string }

export type SearchData = {
  /** Which source the topics were built from, or null when there is none. */
  source: 'api' | 'upload' | null
  rows: QueryRow[]
  api: SourceRow | null
  upload: SourceRow | null
  access: { connected: boolean; summary: string; steps: string[]; serviceEmail: string | null }
}

function toSource(r: Record<string, unknown> | undefined): SourceRow | null {
  if (!r) return null
  return {
    rows: Array.isArray(r.rows) ? (r.rows as QueryRow[]) : [],
    status: r.status === 'error' ? 'error' : 'ok',
    error: (r.error as string | null) ?? null,
    fetchedAt: (r.fetched_at as string) ?? '',
  }
}

export async function loadSearchData(): Promise<SearchData> {
  const admin = createAdminClient()
  const serviceEmail = indexingClientEmail()
  let api: SourceRow | null = null
  let upload: SourceRow | null = null
  if (admin) {
    const { data } = await admin.from('search_console_queries').select('source, rows, status, error, fetched_at')
    const by = new Map((data ?? []).map((r) => [r.source as string, r as Record<string, unknown>]))
    api = toSource(by.get('api'))
    upload = toSource(by.get('upload'))
  }
  const apiOk = !!api && api.status === 'ok' && api.rows.length > 0
  const source = apiOk ? 'api' : upload && upload.rows.length > 0 ? 'upload' : null
  const rows = source === 'api' ? api!.rows : source === 'upload' ? upload!.rows : []
  let access: SearchData['access']
  if (!searchConsoleConfigured()) {
    const p = gscAccessProblem('no Google service-account credentials', serviceEmail)
    access = { connected: false, ...p, serviceEmail }
  } else if (api && api.status === 'ok') {
    access = { connected: true, summary: `Connected — read ${api.rows.length} queries.`, steps: [], serviceEmail }
  } else if (api && api.status === 'error') {
    const p = gscAccessProblem(api.error ?? '', serviceEmail)
    access = { connected: false, ...p, serviceEmail }
  } else {
    access = { connected: false, summary: 'Not read yet.', steps: ['Press "Rebuild now" to read Search Console.'], serviceEmail }
  }
  return { source, rows, api, upload, access }
}

/** Read the API and store the result. Never throws; returns what happened. */
export async function refreshSearchConsole(): Promise<{ ok: boolean; rows: number; error: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, rows: 0, error: 'no service-role client' }
  const nowIso = new Date().toISOString()
  if (!searchConsoleConfigured()) {
    await admin.from('search_console_queries').upsert({ source: 'api', status: 'error', error: 'no Google service-account credentials', fetched_at: nowIso }, { onConflict: 'source' })
    return { ok: false, rows: 0, error: 'no Google service-account credentials' }
  }
  try {
    const rows = await fetchSearchConsoleQueries(28)
    await admin.from('search_console_queries').upsert({ source: 'api', rows, status: 'ok', error: null, fetched_at: nowIso }, { onConflict: 'source' })
    return { ok: true, rows: rows.length, error: null }
  } catch (e) {
    // The earlier rows stay; only the status and a short message change. The
    // message is Google's text — it never carries the key or a token.
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300)
    await admin.from('search_console_queries').upsert({ source: 'api', status: 'error', error: msg, fetched_at: nowIso }, { onConflict: 'source' })
    return { ok: false, rows: 0, error: msg }
  }
}

/** Store an uploaded Queries CSV (already parsed). */
export async function saveUploadedQueries(rows: QueryRow[], actorId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'Server is not configured.' }
  const { error } = await admin
    .from('search_console_queries')
    .upsert({ source: 'upload', rows, status: 'ok', error: null, fetched_at: new Date().toISOString(), updated_by: actorId }, { onConflict: 'source' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

const LANDING_STOP = new Set(['and', 'of', 'the', 'studies', 'islamic', 'language', 'as', 'a', 'first', 'second'])

/** Cities, areas, and the pages and posts that already answer a search. */
export async function loadTopicContext(): Promise<TopicContext> {
  const admin = createAdminClient()
  const [pages, curated, landings, posts, cityNames] = await Promise.all([
    cityPages().catch(() => []),
    curatedAreasByCity().catch(() => new Map<string, string[]>()),
    liveLandingPagesUncached().catch(() => []),
    admin
      ? pageAll((from, to) => admin.from('posts').select('id, title, slug, city, status').eq('status', 'published').order('id').range(from, to)).catch(() => [])
      : Promise.resolve([]),
    admin ? admin.from('location_cities').select('name').limit(1000).then((r) => (r.data ?? []).map((c) => c.name as string)) : Promise.resolve([] as string[]),
  ])
  const cover: CoverPage[] = []
  const properCity = new Map<string, string>()
  for (const c of cityNames) properCity.set(c.toLowerCase(), c)
  for (const p of pages) {
    if (p.count >= CITY_PAGE_THRESHOLD) cover.push({ path: `/tuition-jobs/${p.citySlug}`, label: `Tuition jobs in ${p.city}`, kind: 'city', city: p.city })
    for (const v of p.variants) {
      if (v.count < CITY_PAGE_THRESHOLD) continue
      const path = `/tuition-jobs/${p.citySlug}/${v.slug}`
      if (v.kind === 'female') cover.push({ path, label: `Female teaching jobs in ${p.city}`, kind: 'female', city: p.city })
      else if (v.kind === 'online') cover.push({ path, label: `Online tuition jobs in ${p.city}`, kind: 'online', city: p.city })
      else cover.push({ path, label: `Tuition jobs in ${v.label}, ${p.city}`, kind: 'area', city: p.city, area: v.area ?? v.label })
    }
  }
  for (const l of landings) {
    if (l.kind !== 'tutors') continue
    const words = normaliseQuery(l.subjectOnly ?? l.subjectName)
      .split(' ')
      .filter((w) => w.length > 1 && !LANDING_STOP.has(w))
    if (words.length === 0) continue
    cover.push({ path: `/tutors/${l.citySlug}/${l.subjectSlug}`, label: `${l.subjectName} tutors in ${l.city}`, kind: 'landing', city: l.city, words })
  }
  const areas: TopicContext['areas'] = []
  for (const [cityKey, list] of curated) for (const a of list) areas.push({ city: properCity.get(cityKey) ?? cityKey, area: a })
  const coverPosts: CoverPost[] = (posts as { title: string; slug: string; city: string | null }[]).map((p) => ({ title: p.title, slug: p.slug, city: p.city }))
  return { cities: cityNames, areas, pages: cover, posts: coverPosts }
}

/** The topics from the current source, covered ones included. */
export async function loadSearchTopics(): Promise<{ data: SearchData; topics: SearchTopic[] }> {
  const data = await loadSearchData()
  if (data.rows.length === 0) return { data, topics: [] }
  const ctx = await loadTopicContext()
  return { data, topics: buildSearchTopics(data.rows, ctx) }
}
