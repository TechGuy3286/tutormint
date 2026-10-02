import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// Admin reads of the member activity telemetry (PR99 §2). Service-role only —
// these tables are admin-read and carry no member-facing surface. The admin
// member page (/admin/users/[id]) renders the summary + a session-grouped list.

export type ActivitySummary = {
  lastSeen: string | null
  sessions7: number
  sessions30: number
  timeMs7: number
  timeMs30: number
  topSearches: { term: string; count: number }[]
  staff: boolean
  seed: boolean
}

export type ActivityEventRow = {
  id: string
  kind: string
  label: string | null
  path: string | null
  resultCount: number | null
  at: string
}

export type ActivitySessionRow = {
  id: string
  startedAt: string
  lastSeenAt: string
  activeMs: number
  pageCount: number
  events: ActivityEventRow[]
}

function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export async function loadActivitySummary(userId: string): Promise<ActivitySummary> {
  const admin = createAdminClient()
  const empty: ActivitySummary = {
    lastSeen: null, sessions7: 0, sessions30: 0, timeMs7: 0, timeMs30: 0,
    topSearches: [], staff: false, seed: false,
  }
  if (!admin) return empty

  const d7 = since(7)
  const d30 = since(30)

  const [{ data: s30 }, { data: searches }] = await Promise.all([
    admin
      .from('activity_sessions')
      .select('started_at, last_seen_at, active_ms, is_staff, is_seed')
      .eq('user_id', userId)
      .gte('started_at', d30)
      .order('started_at', { ascending: false })
      .limit(1000),
    admin
      .from('activity_events')
      .select('label')
      .eq('user_id', userId)
      .eq('kind', 'search')
      .gte('created_at', d30)
      .limit(1000),
  ])

  const sessions = s30 ?? []
  let sessions7 = 0, timeMs7 = 0, timeMs30 = 0
  let lastSeen: string | null = null
  let staff = false, seed = false
  for (const s of sessions) {
    const ms = Number(s.active_ms ?? 0)
    timeMs30 += ms
    if ((s.started_at as string) >= d7) {
      sessions7 += 1
      timeMs7 += ms
    }
    const ls = s.last_seen_at as string
    if (!lastSeen || ls > lastSeen) lastSeen = ls
    if (s.is_staff) staff = true
    if (s.is_seed) seed = true
  }

  // Top 5 search terms over 30 days (case-folded; already masked at ingest).
  const counts = new Map<string, number>()
  for (const r of searches ?? []) {
    const term = ((r.label as string) ?? '').trim().toLowerCase()
    if (!term) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  const topSearches = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term, count]) => ({ term, count }))

  return {
    lastSeen,
    sessions7,
    sessions30: sessions.length,
    timeMs7,
    timeMs30,
    topSearches,
    staff,
    seed,
  }
}

const SESSION_PAGE = 15

/** Sessions newest-first with their events, keyset-paged on started_at. */
export async function loadActivitySessions(
  userId: string,
  { cursor, limit = SESSION_PAGE }: { cursor?: string | null; limit?: number } = {},
): Promise<{ rows: ActivitySessionRow[]; nextCursor: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], nextCursor: null }

  let q = admin
    .from('activity_sessions')
    .select('id, started_at, last_seen_at, active_ms, page_count')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit + 1)
  if (cursor) q = q.lt('started_at', cursor)

  const { data } = await q
  const all = data ?? []
  const hasMore = all.length > limit
  const page = hasMore ? all.slice(0, limit) : all
  const nextCursor = hasMore ? (page[page.length - 1].started_at as string) : null

  const sessionIds = page.map((s) => s.id as string)
  const eventsBySession = new Map<string, ActivityEventRow[]>()
  if (sessionIds.length) {
    const { data: evs } = await admin
      .from('activity_events')
      .select('id, session_id, kind, label, path, result_count, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false })
      .limit(500)
    for (const e of evs ?? []) {
      const sid = e.session_id as string
      const arr = eventsBySession.get(sid) ?? []
      arr.push({
        id: e.id as string,
        kind: e.kind as string,
        label: (e.label as string) ?? null,
        path: (e.path as string) ?? null,
        resultCount: (e.result_count as number) ?? null,
        at: e.created_at as string,
      })
      eventsBySession.set(sid, arr)
    }
  }

  const rows: ActivitySessionRow[] = page.map((s) => ({
    id: s.id as string,
    startedAt: s.started_at as string,
    lastSeenAt: s.last_seen_at as string,
    activeMs: Number(s.active_ms ?? 0),
    pageCount: (s.page_count as number) ?? 0,
    events: eventsBySession.get(s.id as string) ?? [],
  }))

  return { rows, nextCursor }
}
