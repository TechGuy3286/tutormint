import { createAdminClient } from '@/lib/supabase/admin'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import type { AuditRow } from '@/app/admin/audit/AuditEntry'

// One window of the audit trail, shared by the page and its load-more route.
//
// (created_at, id) is the key. created_at alone is not unique — two mutations
// inside the same millisecond are ordinary on an admin working a queue — and a
// non-unique key means a cursor cannot say which side of a tie it sits on, so
// an entry gets served twice or skipped. The id is the tiebreaker that makes it
// total.

export type AuditFilters = { action: string; actor: string }

type AuditCursor = { c: string; i: string }

export async function auditPage({
  filters,
  limit,
  offset = 0,
  cursor = null,
}: {
  filters: AuditFilters
  limit: number
  offset?: number
  cursor?: string | null
}): Promise<{ entries: AuditRow[]; nextCursor: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { entries: [], nextCursor: null }

  let query = admin
    .from('admin_audit_log')
    .select('id, actor_id, actor_role, actor_email, action, target_type, target_id, detail, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  // Prefix filter: 'tutor' matches tutor.approve, tutor.suspend and so on, so
  // the chips stay meaningful as new actions are added.
  if (filters.action !== 'all') query = query.like('action', `${filters.action}.%`)
  if (filters.actor.trim()) query = query.ilike('actor_email', `%${filters.actor.trim()}%`)

  const after = decodeCursor<AuditCursor>(cursor)
  if (after) {
    query = query.or(
      [`created_at.lt."${after.c}"`, `and(created_at.eq."${after.c}",id.lt."${after.i}")`].join(','),
    )
  } else if (offset > 0) {
    query = query.range(offset, offset + limit - 1)
  }

  const { data } = await query
  const rows = (data ?? []) as unknown as AuditRow[]

  // Names for the linked targets. Resolved here, with the service role, so the
  // browser never gets a way to turn an arbitrary uuid into a person's name.
  const targetIds = Array.from(new Set(rows.map((e) => e.target_id).filter(Boolean) as string[])).filter(
    (v) => /^[0-9a-f-]{36}$/i.test(v),
  )

  if (targetIds.length > 0) {
    const { data: people } = await admin.from('profiles').select('id, full_name').in('id', targetIds)
    const nameById = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]))
    for (const e of rows) {
      e.target_name = e.target_id ? (nameById.get(e.target_id) ?? null) : null
    }
  }

  const last = rows[rows.length - 1]

  return {
    entries: rows,
    // A short window is the end. There is no cheap exact count here — the log
    // grows without bound and counting it on every request to decide whether to
    // show one button would be the most expensive query on the screen.
    nextCursor:
      rows.length < limit || !last ? null : encodeCursor({ c: last.created_at, i: last.id } satisfies AuditCursor),
  }
}
