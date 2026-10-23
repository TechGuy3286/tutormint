import 'server-only'

// lib/tuitionPosting.ts
//
// The Tuition posting activity board (owner, 15 Oct 2026). One row per staff
// member who posts tuitions, plus a Team total. Read from admin_audit_log by
// ACTOR ('job.post'), because a team tuition belongs to the team account — the
// audit log is what records who posted it (the same reasoning as Staff
// activity). The maths is pure in lib/tuitionPostingCore.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { recentRepeats } from '@/lib/duplicates'
import {
  countPosts,
  postingWindows,
  sortPostingRows,
  totalRow,
  type PostingRow,
} from '@/lib/tuitionPostingCore'

/** Roles whose members post tuitions; all of them appear even with zero. */
const POSTING_ROLES = new Set(['tuitions_staff', 'operations', 'supervisor'])

export async function loadTuitionPosting(nowMs = Date.now()): Promise<{ rows: PostingRow[]; total: PostingRow }> {
  const empty = { rows: [], total: totalRow([]) }
  const admin = createAdminClient()
  if (!admin) return empty

  const w = postingWindows(nowMs)
  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name, email, admin_role, is_suspended')
    .eq('role', 'admin')
    .not('admin_role', 'is', null)
  const staffRows = staff ?? []
  if (staffRows.length === 0) return empty

  const ids = staffRows.map((s) => s.id as string)
  const posts = await pageAll((from, to) =>
    admin
      .from('admin_audit_log')
      .select('id, actor_id, created_at')
      .eq('action', 'job.post')
      .in('actor_id', ids)
      .gte('created_at', new Date(w.prev7Start).toISOString())
      .order('id')
      .range(from, to),
  )
  const timesBy = new Map<string, number[]>()
  for (const p of posts) {
    const k = p.actor_id as string
    const list = timesBy.get(k) ?? []
    list.push(Date.parse(p.created_at as string))
    timesBy.set(k, list)
  }

  // Repeats this week, attributed by the poster's name or email (the
  // Duplicates view's own count).
  const repeats = await recentRepeats(new Date(nowMs - 7 * 86_400_000)).catch(() => [])
  const repeatsBy = new Map<string, number>()
  for (const r of repeats) {
    const k = (r.repeat.postedBy ?? '').trim().toLowerCase()
    if (k) repeatsBy.set(k, (repeatsBy.get(k) ?? 0) + 1)
  }

  const rows: PostingRow[] = []
  for (const s of staffRows) {
    const id = s.id as string
    const times = timesBy.get(id) ?? []
    const rawName = ((s.full_name as string | null) ?? '').trim()
    const email = ((s.email as string | null) ?? '').trim().toLowerCase()
    const reps = (repeatsBy.get(rawName.toLowerCase()) ?? 0) + (email ? repeatsBy.get(email) ?? 0 : 0)
    // A suspended staff member, or one whose role does not post, appears only
    // when they actually posted in the last two weeks.
    const shows = times.length > 0 || reps > 0 || (!s.is_suspended && POSTING_ROLES.has(s.admin_role as string))
    if (!shows) continue
    rows.push({ id, name: formatName(rawName) || email || '—', counts: countPosts(times, w), repeats: reps })
  }
  const sorted = sortPostingRows(rows)
  return { rows: sorted, total: totalRow(sorted) }
}
