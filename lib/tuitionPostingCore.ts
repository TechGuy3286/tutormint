// lib/tuitionPostingCore.ts
//
// PURE. The Tuition posting activity board (owner, 15 Oct 2026): per staff
// member, tuitions posted Today | Yesterday | Last 7 days, two comparisons and
// the repeats this week. Pakistan time throughout (UTC+5, no daylight saving).
//
//   Today vs Yesterday   today SO FAR against yesterday UP TO THE SAME TIME OF
//                        DAY — a fair race at 11 am, not "11 am vs all of
//                        yesterday". "—" when yesterday-to-time is 0.
//   Last 7 days          the last 7 Pakistan-time days including today, against
//                        the 7 days before them. "—" when the earlier week is 0.

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
  /** Yesterday from 00:00 up to the same time of day as now. */
  yesterdayToTime: number
  last7: number
  prev7: number
}

export function emptyPostingCounts(): PostingCounts {
  return { today: 0, yesterday: 0, yesterdayToTime: 0, last7: 0, prev7: 0 }
}

/** Count one staff member's post times into the windows. */
export function countPosts(postedAtMs: number[], w: PostingWindows): PostingCounts {
  const c = emptyPostingCounts()
  for (const t of postedAtMs) {
    if (!Number.isFinite(t) || t > w.now) continue
    if (t >= w.todayStart) c.today++
    if (t >= w.yesterdayStart && t < w.todayStart) {
      c.yesterday++
      if (t <= w.yesterdaySameTime) c.yesterdayToTime++
    }
    if (t >= w.last7Start) c.last7++
    else if (t >= w.prev7Start) c.prev7++
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

/** Highest Today first, then by the last 7 days, then by name. */
export function sortPostingRows(rows: PostingRow[]): PostingRow[] {
  return [...rows].sort(
    (a, b) => b.counts.today - a.counts.today || b.counts.last7 - a.counts.last7 || a.name.localeCompare(b.name),
  )
}

/** The Team total row: every column summed. */
export function totalRow(rows: PostingRow[]): PostingRow {
  const counts = emptyPostingCounts()
  let repeats = 0
  for (const r of rows) {
    counts.today += r.counts.today
    counts.yesterday += r.counts.yesterday
    counts.yesterdayToTime += r.counts.yesterdayToTime
    counts.last7 += r.counts.last7
    counts.prev7 += r.counts.prev7
    repeats += r.repeats
  }
  return { id: 'team', name: 'Team total', counts, repeats }
}
