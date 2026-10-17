// lib/overviewTrendCore.ts
//
// Admin → Overview card figures (owner, 17 Oct 2026). PURE, so the time
// windows are tested. ONE helper for every card, so the windows always match.
// All Pakistan time:
//
//   today        00:00 today → now
//   yesterday    the whole of yesterday
//   last 7 days  00:00 six days ago → now (today and the six full days before)
//   month        the 1st of this month → now
//
// The cards show Today (big), Yesterday, Last 7 days and one bottom line — no
// arrows, no explanations (owner, 17 Oct 2026, superseding the ▲/▼ pills).

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

type Span = { start: number; end: number }

export type Windows = { today: Span; yesterday: Span; last7: Span; month: Span }

export function trendWindows(nowMs: number): Windows {
  const today = pkDayStart(nowMs)
  const end = nowMs + 1
  return {
    today: { start: today, end },
    yesterday: { start: today - DAY_MS, end: today },
    last7: { start: today - 6 * DAY_MS, end },
    month: { start: pkMonthStart(nowMs), end },
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

function inWindow(events: TrendEvent[], w: Span): TrendEvent[] {
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

export type WindowFigures = { today: number; yesterday: number; last7: number; month: number }

/** Counts (distinct keys when given) or, with `amounts`, sums per window. */
export function windowFigures(events: TrendEvent[], nowMs: number, opts: { amounts?: boolean } = {}): WindowFigures {
  const w = trendWindows(nowMs)
  const f = (x: Span) => (opts.amounts ? sum : count)(inWindow(events, x))
  return { today: f(w.today), yesterday: f(w.yesterday), last7: f(w.last7), month: f(w.month) }
}

/** What a square Overview card shows, already formatted. */
export type CardFigures = {
  today: string
  yesterday: string
  last7: string
  /** The one tiny grey line — label and figure, e.g. Total · 412 — or null. */
  bottom: { label: string; value: string } | null
}

/** Format a card's figures: counts as "1,234", amounts as "Rs 1,234". */
export function cardFigures(f: WindowFigures, opts: { rupees?: boolean; bottom?: { label: string; value: string } | null } = {}): CardFigures {
  const fmt = (n: number) => (opts.rupees ? rupees(n) : n.toLocaleString('en-US'))
  return { today: fmt(f.today), yesterday: fmt(f.yesterday), last7: fmt(f.last7), bottom: opts.bottom ?? null }
}

/** "Rs 12,345" — whole rupees with thousands separators. */
export function rupees(n: number): string {
  return `Rs ${Math.round(n).toLocaleString('en-US')}`
}
