// lib/overviewTrendCore.ts
//
// Admin → Overview card trend lines (owner, 17 Oct 2026). PURE, so the time
// windows are tested. ONE helper for every card, so the windows always match:
//
//   today        00:00 Pakistan time → now
//   yesterday    the whole of yesterday (Pakistan time)
//   7 days       the last 7 × 24 hours (the window the pink "Signed up today,
//                not paid" card and the "Paid today" card already used)
//   month        the 1st of this month (Pakistan time) → now
//
// The arrow compares like with like: today SO FAR against yesterday UP TO THE
// SAME TIME OF DAY (at 1 am, today's first hour against yesterday's first
// hour), and for revenue this month so far against the same point last month.
// A comparison with 0 is "— vs 0", never "▲ ∞%".

export const DAY_MS = 86_400_000
const PK_OFFSET_MS = 5 * 3600_000

export function pkDayStart(nowMs: number): number {
  const s = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - PK_OFFSET_MS
}

export function pkMonthStart(nowMs: number): number {
  const s = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) - PK_OFFSET_MS
}

function prevMonthStart(nowMs: number): number {
  const s = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1) - PK_OFFSET_MS
}

export type Windows = {
  today: { start: number; end: number }
  yesterday: { start: number; end: number }
  /** Yesterday from 00:00 up to the same time of day as now. */
  yesterdaySameTime: { start: number; end: number }
  last7: { start: number; end: number }
  month: { start: number; end: number }
  /** Last month from its 1st up to the same point (clamped to its end). */
  lastMonthSamePoint: { start: number; end: number }
}

export function trendWindows(nowMs: number): Windows {
  const today = pkDayStart(nowMs)
  const month = pkMonthStart(nowMs)
  const prev = prevMonthStart(nowMs)
  const end = nowMs + 1
  return {
    today: { start: today, end },
    yesterday: { start: today - DAY_MS, end: today },
    yesterdaySameTime: { start: today - DAY_MS, end: end - DAY_MS },
    last7: { start: nowMs - 7 * DAY_MS, end },
    month: { start: month, end },
    lastMonthSamePoint: { start: prev, end: Math.min(month, prev + (end - month)) },
  }
}

/** One event: when it happened, an optional key (count each key once per
 *  window — e.g. one tutor paying twice), and an optional amount. */
export type TrendEvent = { at: string | number | null | undefined; key?: string | null; amount?: number }

function ms(at: TrendEvent['at']): number {
  if (typeof at === 'number') return at
  const t = Date.parse(at ?? '')
  return Number.isFinite(t) ? t : NaN
}

function inWindow(events: TrendEvent[], w: { start: number; end: number }): TrendEvent[] {
  return events.filter((e) => {
    const t = ms(e.at)
    return Number.isFinite(t) && t >= w.start && t < w.end
  })
}

function count(events: TrendEvent[]): number {
  if (events.some((e) => e.key)) return new Set(events.map((e, i) => e.key ?? `#${i}`)).size
  return events.length
}

function sum(events: TrendEvent[]): number {
  return Math.round(events.reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100
}

export type WindowFigures = {
  today: number
  yesterday: number
  yesterdaySameTime: number
  last7: number
  month: number
  lastMonthSamePoint: number
}

/** Counts (distinct keys when given) or, with `amounts`, sums per window. */
export function windowFigures(events: TrendEvent[], nowMs: number, opts: { amounts?: boolean } = {}): WindowFigures {
  const w = trendWindows(nowMs)
  const f = (x: { start: number; end: number }) => (opts.amounts ? sum : count)(inWindow(events, x))
  return {
    today: f(w.today),
    yesterday: f(w.yesterday),
    yesterdaySameTime: f(w.yesterdaySameTime),
    last7: f(w.last7),
    month: f(w.month),
    lastMonthSamePoint: f(w.lastMonthSamePoint),
  }
}

export type Trend = {
  /** "▲ 25% vs yesterday" · "▼ 10% vs yesterday" · "— 0% vs yesterday" · "— vs 0" */
  text: string
  /** up = more (green), down = fewer (red), flat = grey */
  tone: 'up' | 'down' | 'flat'
  /** The hover text: what it was compared with. */
  title: string
}

/** The arrow for `now` against `before`. More is better on every card. */
export function trendOf(now: number, before: number, vs: string, title: string): Trend {
  if (!before) return { text: '— vs 0', tone: 'flat', title }
  const pct = Math.round(((now - before) / before) * 100)
  if (pct > 0) return { text: `▲ +${pct}% vs ${vs}`, tone: 'up', title }
  if (pct < 0) return { text: `▼ −${Math.abs(pct)}% vs ${vs}`, tone: 'down', title }
  return { text: `— 0% vs ${vs}`, tone: 'flat', title }
}

/** "1:05 am" in Pakistan time. */
export function pkClock(nowMs: number): string {
  const s = new Date(nowMs + PK_OFFSET_MS)
  const h = s.getUTCHours()
  const m = String(s.getUTCMinutes()).padStart(2, '0')
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Today so far against yesterday up to the same time. */
export function dayTrend(f: WindowFigures, nowMs: number): Trend {
  return trendOf(f.today, f.yesterdaySameTime, 'yesterday', `Compared with yesterday up to ${pkClock(nowMs)}`)
}

/** This month so far against last month up to the same point ("1–17 Sep"). */
export function monthTrend(f: WindowFigures, nowMs: number): Trend {
  const w = trendWindows(nowMs)
  const p = new Date(w.lastMonthSamePoint.start + PK_OFFSET_MS)
  const lastDay = new Date(w.lastMonthSamePoint.end - 1 + PK_OFFSET_MS).getUTCDate()
  const label = `1–${lastDay} ${MONTHS[p.getUTCMonth()]}`
  return trendOf(f.month, f.lastMonthSamePoint, label, `Compared with ${label} up to ${pkClock(nowMs)}`)
}

/** What a card's small line shows: its parts and its arrow. */
export type CardTrend = { parts: string[]; trend: Trend }
