import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import {
  buildTimeline,
  type AuditRow,
  type LogRow,
  type SessionRow,
  type TimelineGroup,
  type TimelineItem,
} from '@/lib/memberTimelineCore'

// The one admin member timeline (owner, 20 Oct 2026) — reads the three sources
// (the member's event log, the admin actions naming them, their visits) and
// hands them to the pure rule in lib/memberTimelineCore. The whole grouped list
// is built for every page request and then sliced, so the total the page shows
// is exactly the number of lines the list will reach. Nothing is written.
//
// Visits (sessions and pages) are shown only to the roles that could see the
// old "Activity" box: `withVisits` is decided by the caller from the viewer.

export const TIMELINE_PAGE = 30

export async function loadUnifiedTimeline({
  userId,
  group,
  offset = 0,
  limit = TIMELINE_PAGE,
  withVisits,
}: {
  userId: string
  group: TimelineGroup
  offset?: number
  limit?: number
  withVisits: boolean
}): Promise<{ rows: TimelineItem[]; nextCursor: string | null; total: number }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], nextCursor: null, total: 0 }

  type R = Record<string, unknown>
  type Page = Promise<{ data: R[] | null; error: { message: string } | null }>
  const [logRows, auditRows, sessionRows] = await Promise.all([
    pageAll<R>((from, to) =>
      admin
        .from('user_activity_log')
        .select('id, event, meta, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to) as unknown as Page,
    ),
    pageAll<R>((from, to) =>
      admin
        .from('admin_audit_log')
        .select('id, action, detail, actor_id, created_at')
        .eq('target_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to) as unknown as Page,
    ),
    withVisits
      ? pageAll<R>((from, to) =>
          admin
            .from('activity_sessions')
            .select('id, started_at, active_ms, page_count')
            .eq('user_id', userId)
            .order('started_at', { ascending: false })
            .range(from, to) as unknown as Page,
        )
      : Promise.resolve([] as R[]),
  ])

  // Who did each admin action: the staff member's name, never an email.
  const actorIds = Array.from(new Set(auditRows.map((a) => a.actor_id as string).filter(Boolean)))
  const names = new Map<string, string>()
  if (actorIds.length) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', actorIds)
    for (const p of data ?? []) names.set(p.id as string, formatName(p.full_name as string | null) || 'Staff')
  }

  const logs: LogRow[] = logRows.map((r) => ({
    id: r.id as string,
    event: r.event as string,
    meta: (r.meta as Record<string, unknown>) ?? {},
    at: r.created_at as string,
  }))
  const audits: AuditRow[] = auditRows.map((r) => ({
    id: r.id as string,
    action: r.action as string,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    at: r.created_at as string,
    actorName: r.actor_id ? (names.get(r.actor_id as string) ?? 'Staff') : null,
  }))
  const sessions: SessionRow[] = sessionRows.map((r) => ({
    id: r.id as string,
    startedAt: r.started_at as string,
    activeMs: Number(r.active_ms ?? 0),
    pageCount: Number(r.page_count ?? 0),
  }))

  const all = buildTimeline({ logs, audits, sessions }, group)
  const start = Math.max(0, offset)
  const rows = all.slice(start, start + limit)
  const end = start + rows.length
  return { rows, nextCursor: end < all.length ? String(end) : null, total: all.length }
}

/** The pages of one visit, for "tap to see the pages". */
export async function loadSessionPages(userId: string, sessionId: string) {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('activity_events')
    .select('id, kind, label, path, result_count, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []).map((e) => ({
    id: e.id as string,
    kind: e.kind as string,
    label: (e.label as string) ?? null,
    resultCount: (e.result_count as number) ?? null,
    at: e.created_at as string,
  }))
}
