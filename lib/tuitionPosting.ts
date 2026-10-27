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
import { consentFor } from '@/lib/tuitionConsent'
import { isRecorded } from '@/lib/tuitionConsentCore'
import {
  countConsent,
  countPosts,
  formerRow,
  postingWindows,
  sortPostingRows,
  totalRow,
  type PostingRow,
} from '@/lib/tuitionPostingCore'

export type TuitionPostingBoard = {
  rows: PostingRow[]
  /** Former staff (staff access removed), each with their own counts. */
  former: PostingRow[]
  /** The collapsed "Former staff" row (null when nobody former ever posted). */
  formerTotal: PostingRow | null
  /** Current AND former staff. */
  total: PostingRow
}

/** Roles whose members post tuitions; all of them appear even with zero. */
const POSTING_ROLES = new Set(['tuitions_staff', 'operations', 'supervisor'])

export async function loadTuitionPosting(nowMs = Date.now()): Promise<TuitionPostingBoard> {
  const empty: TuitionPostingBoard = { rows: [], former: [], formerTotal: null, total: totalRow([]) }
  const admin = createAdminClient()
  if (!admin) return empty

  const w = postingWindows(nowMs)
  const [{ data: staff }, { data: formerStaff }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email, admin_role, is_suspended').eq('role', 'admin').not('admin_role', 'is', null),
    // Former staff (migration 198): staff access removed, history kept.
    admin.from('profiles').select('id, full_name, email').not('former_staff_at', 'is', null),
  ])
  const formerIds = new Set((formerStaff ?? []).map((s) => s.id as string))
  const staffRows = [
    ...(staff ?? []).filter((s) => !formerIds.has(s.id as string)),
    ...(formerStaff ?? []).map((s) => ({ ...s, admin_role: null, is_suspended: true, former: true })),
  ] as { id: string; full_name: string | null; email: string | null; admin_role: string | null; is_suspended: boolean | null; former?: boolean }[]
  if (staffRows.length === 0) return empty

  const ids = staffRows.map((s) => s.id as string)
  const posts = await pageAll((from, to) =>
    admin
      .from('admin_audit_log')
      .select('id, actor_id, created_at, target_id')
      .eq('action', 'job.post')
      .in('actor_id', ids)
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
  // Parent consent per posted tuition (owner, 27 Oct 2026).
  const consent = await consentFor(posts.map((p) => p.target_id as string).filter(Boolean))
  const consentBy = new Map<string, { at: number; recorded: boolean }[]>()
  for (const p of posts) {
    const k = p.actor_id as string
    const list = consentBy.get(k) ?? []
    list.push({ at: Date.parse(p.created_at as string), recorded: isRecorded(consent.get(p.target_id as string)) })
    consentBy.set(k, list)
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
  const former: PostingRow[] = []
  for (const s of staffRows) {
    const id = s.id as string
    const times = timesBy.get(id) ?? []
    const rawName = ((s.full_name as string | null) ?? '').trim()
    const email = ((s.email as string | null) ?? '').trim().toLowerCase()
    const reps = (repeatsBy.get(rawName.toLowerCase()) ?? 0) + (email ? repeatsBy.get(email) ?? 0 : 0)
    const row = { id, name: formatName(rawName) || '—', counts: countPosts(times, w), repeats: reps, consent: countConsent(consentBy.get(id) ?? [], w) }
    if (s.former) {
      if (times.length > 0 || reps > 0) former.push(row)
      continue
    }
    // A suspended staff member, or one whose role does not post, appears only
    // when they actually posted (any time) or have repeats this week.
    const shows = times.length > 0 || reps > 0 || (!s.is_suspended && POSTING_ROLES.has(s.admin_role as string))
    if (!shows) continue
    rows.push(row)
  }
  const sorted = sortPostingRows(rows)
  const formerSorted = sortPostingRows(former)
  return {
    rows: sorted,
    former: formerSorted,
    formerTotal: formerSorted.length > 0 ? formerRow(formerSorted) : null,
    total: totalRow(sorted, formerSorted),
  }
}
