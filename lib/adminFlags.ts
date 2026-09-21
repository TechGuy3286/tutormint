import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { FlagRow } from '@/lib/adminFlagsShared'

// The flagged-content queue (PR40 §2), read through the service role. Each open
// abuse_flags row is shown with both members (name + whether already suspended),
// the flagged text, what matched and when. Staff clear a flag or suspend/reinstate
// the author from here. The row shape and label are in lib/adminFlagsShared (the
// client queue component reads them).

export type { FlagRow } from '@/lib/adminFlagsShared'

export async function loadFlagQueue(limit = 200): Promise<FlagRow[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: flags } = await admin
    .from('abuse_flags')
    .select('id, source, subject_id, recipient_id, content, matched, context, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = flags ?? []
  if (rows.length === 0) return []

  const ids = [
    ...new Set(rows.flatMap((r) => [r.subject_id as string, r.recipient_id as string]).filter(Boolean)),
  ]
  const { data: profs } = await admin
    .from('profiles')
    .select('id, full_name, is_suspended')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const byId = new Map((profs ?? []).map((p) => [p.id as string, p]))

  return rows.map((r) => {
    const s = byId.get(r.subject_id as string)
    const rec = r.recipient_id ? byId.get(r.recipient_id as string) : null
    return {
      id: r.id as string,
      source: r.source as FlagRow['source'],
      subject: {
        id: r.subject_id as string,
        name: (s?.full_name as string | null) ?? '—',
        suspended: !!s?.is_suspended,
      },
      recipient: r.recipient_id
        ? { id: r.recipient_id as string, name: (rec?.full_name as string | null) ?? '—' }
        : null,
      content: (r.content as string) ?? '',
      matched: (r.matched as string[] | null) ?? [],
      context: (r.context as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at as string,
    }
  })
}

/** The open-flag count, for the nav badge / heading. */
export async function openFlagCount(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin
    .from('abuse_flags')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  return count ?? 0
}
