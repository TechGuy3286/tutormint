// lib/tuitionPostingCore.ts
//
// PURE. The Tuition posting activity board. Columns (owner, 27 Oct 2026):
// Staff | Today | Yesterday | Last 7 days | All time | Repeated this week,
// sorted by Last 7 days; the two comparison columns are gone. Former staff are
// one collapsed "Former staff" row and count in the Team total. Pakistan time
// throughout (UTC+5, no daylight saving). change()/changeLabel() stay: the Paid
// sign-ups tab still uses them.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 00:00 Pakistan time of the day `nowMs` falls in, as a UTC instant. */
export function pktDayStartMs(nowMs: number): number {
  const local = nowMs + PKT_OFFSET_MS
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - PKT_OFFSET_MS
}

export type PostingWindows = {
  todayStart: number
  yesterdayStart: number
  /** Yesterday at the same time of day as now. */
  yesterdaySameTime: number
  last7Start: number
  prev7Start: number
  now: number
}

export function postingWindows(nowMs: number): PostingWindows {
  const todayStart = pktDayStartMs(nowMs)
  return {
    todayStart,
    yesterdayStart: todayStart - DAY_MS,
    yesterdaySameTime: nowMs - DAY_MS,
    last7Start: todayStart - 6 * DAY_MS,
    prev7Start: todayStart - 13 * DAY_MS,
    now: nowMs,
  }
}

export type PostingCounts = {
  today: number
  yesterday: number
  last7: number
  /** Every tuition this staff member ever posted. */
  allTime: number
}

export function emptyPostingCounts(): PostingCounts {
  return { today: 0, yesterday: 0, last7: 0, allTime: 0 }
}

/** Count one staff member's post times into the windows. */
export function countPosts(postedAtMs: number[], w: PostingWindows): PostingCounts {
  const c = emptyPostingCounts()
  for (const t of postedAtMs) {
    if (!Number.isFinite(t) || t > w.now) continue
    c.allTime++
    if (t >= w.todayStart) c.today++
    if (t >= w.yesterdayStart && t < w.todayStart) c.yesterday++
    if (t >= w.last7Start) c.last7++
  }
  return c
}

export type Change = { direction: 'up' | 'down' | 'same'; pct: number } | null

/** Percentage change from `before` to `now`; null ("—") when `before` is 0. */
export function change(now: number, before: number): Change {
  if (before <= 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  return { direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'same', pct: Math.abs(pct) }
}

/** "▲ 25%", "▼ 40%", "0%" or "—". */
export function changeLabel(c: Change): string {
  if (!c) return '—'
  if (c.direction === 'same') return '0%'
  return `${c.direction === 'up' ? '▲' : '▼'} ${c.pct}%`
}

export type PostingRow = { id: string; name: string; counts: PostingCounts; repeats: number }

/** Highest Last 7 days first (owner, 27 Oct 2026), then Today, then by name. */
export function sortPostingRows(rows: PostingRow[]): PostingRow[] {
  return [...rows].sort(
    (a, b) => b.counts.last7 - a.counts.last7 || b.counts.today - a.counts.today || a.name.localeCompare(b.name),
  )
}

/** Every column summed, under one name (the Team total, or the Former staff row). */
export function sumRows(rows: PostingRow[], id: string, name: string): PostingRow {
  const counts = emptyPostingCounts()
  let repeats = 0
  for (const r of rows) {
    counts.today += r.counts.today
    counts.yesterday += r.counts.yesterday
    counts.last7 += r.counts.last7
    counts.allTime += r.counts.allTime
    repeats += r.repeats
  }
  return { id, name, counts, repeats }
}

/** The Team total row: current AND former staff, every column summed. */
export function totalRow(rows: PostingRow[], former: PostingRow[] = []): PostingRow {
  return sumRows([...rows, ...former], 'team', 'Team total')
}

/** The one collapsed "Former staff" row. */
export function formerRow(former: PostingRow[]): PostingRow {
  return sumRows(former, 'former', 'Former staff')
}

/** The table's columns, in order (owner, 27 Oct 2026). */
export const POSTED_COLUMNS = ['Staff', 'Today', 'Yesterday', 'Last 7 days', 'All time', 'Repeated this week'] as const
