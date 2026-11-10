// lib/paidSignupsCore.ts
//
// The paid sign-ups view behind the Overview "Paid" card (owner, 9 Nov 2026) —
// the PURE half. A paid sign-up is a tutor's FIRST approved, not refunded
// Verification Fee (lib/staffTargetsCore firstPaidAt — the rule Team activity
// already counts), dated by its approval, each tutor once. Staff, test, seed
// and team accounts are left out by the loader. Counts only: no rupee figure
// is ever part of this data, so Backend Support may see all of it.
//
// Every day, week and month boundary is Pakistan time (Asia/Karachi, UTC+5, no
// daylight saving). A week runs Monday to Sunday.

export const PAID_TARGET = 700
const PK_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY = 86_400_000

/** One paid tutor sign-up: when it was paid and who brought it
 *  (a staff id, or SELF_ID / ADMIN_ID). Never a name, phone or amount. */
export type PaidSignup = { at: string; by: string }

export const SELF_ID = 'self'
export const ADMIN_ID = 'admin'
export const SELF_LABEL = 'Self (no staff link)'
export const ADMIN_LABEL = 'Admin (credit refused under the rules)'

export type PaidSignupsPayload = { rows: PaidSignup[]; names: Record<string, string> }

/** The calendar day in Pakistan time, as YYYY-MM-DD. */
export function pkDay(ms: number): string {
  return new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10)
}

/** 00:00 PKT of the day containing `ms`. */
export function pkDayStart(ms: number): number {
  const d = new Date(ms + PK_OFFSET_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - PK_OFFSET_MS
}

/** 00:00 PKT on the Monday of the week containing `ms`. */
export function pkWeekStart(ms: number): number {
  const day = pkDayStart(ms)
  const dow = new Date(day + PK_OFFSET_MS).getUTCDay() // 0 = Sunday
  return day - ((dow + 6) % 7) * DAY
}

/** 00:00 PKT on the 1st of the month containing `ms`, shifted by `add` months. */
export function pkMonthStart(ms: number, add = 0): number {
  const d = new Date(ms + PK_OFFSET_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) - PK_OFFSET_MS
}

export type PeriodKey = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all'
export const PAID_PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'all', label: 'All time' },
]

export function parsePeriod(v: string | null | undefined): PeriodKey {
  return PAID_PERIODS.some((p) => p.key === v) ? (v as PeriodKey) : 'this_month'
}

/** [start, end) of a period. */
export function periodRange(key: PeriodKey, nowMs: number): { start: number; end: number } {
  const end = nowMs + 1
  switch (key) {
    case 'today':
      return { start: pkDayStart(nowMs), end }
    case 'yesterday':
      return { start: pkDayStart(nowMs) - DAY, end: pkDayStart(nowMs) }
    case 'this_week':
      return { start: pkWeekStart(nowMs), end }
    case 'last_week':
      return { start: pkWeekStart(nowMs) - 7 * DAY, end: pkWeekStart(nowMs) }
    case 'this_month':
      return { start: pkMonthStart(nowMs), end }
    case 'last_month':
      return { start: pkMonthStart(nowMs, -1), end: pkMonthStart(nowMs) }
    case 'all':
      return { start: 0, end }
  }
}

export function countIn(rows: PaidSignup[], r: { start: number; end: number }): number {
  let n = 0
  for (const x of rows) {
    const t = Date.parse(x.at)
    if (Number.isFinite(t) && t >= r.start && t < r.end) n++
  }
  return n
}

/** The window to compare a period with: the period before it. A period still
 *  running is compared with the same stretch of the one before (this week so
 *  far against last week up to the same day and time). */
export function previousRange(key: 'this_week' | 'last_week' | 'this_month' | 'last_month', nowMs: number): { start: number; end: number } {
  const week = 7 * DAY
  switch (key) {
    case 'this_week': {
      const s = pkWeekStart(nowMs)
      return { start: s - week, end: nowMs + 1 - week }
    }
    case 'last_week': {
      const s = pkWeekStart(nowMs) - week
      return { start: s - week, end: s }
    }
    case 'this_month': {
      const s = pkMonthStart(nowMs)
      const prev = pkMonthStart(nowMs, -1)
      // The same number of days into last month, capped at its end.
      return { start: prev, end: Math.min(prev + (nowMs + 1 - s), s) }
    }
    case 'last_month':
      return { start: pkMonthStart(nowMs, -2), end: pkMonthStart(nowMs, -1) }
  }
}

export type Change = { prev: number; diff: number; arrow: '↑' | '↓' | '→' }

export function changeOf(now: number, prev: number): Change {
  const diff = now - prev
  return { prev, diff, arrow: diff > 0 ? '↑' : diff < 0 ? '↓' : '→' }
}

export type PeriodCount = { key: PeriodKey; label: string; count: number; change: Change | null }

export function periodCounts(rows: PaidSignup[], nowMs: number): PeriodCount[] {
  return PAID_PERIODS.map(({ key, label }) => {
    const count = countIn(rows, periodRange(key, nowMs))
    const change =
      key === 'this_week' || key === 'last_week' || key === 'this_month' || key === 'last_month'
        ? changeOf(count, countIn(rows, previousRange(key, nowMs)))
        : null
    return { key, label, count, change }
  })
}

/** The last `days` days, oldest first, one bar each (Pakistan days). */
export function dailyBars(rows: PaidSignup[], nowMs: number, days = 30): { day: string; count: number }[] {
  const today = pkDayStart(nowMs)
  const out: { day: string; count: number }[] = []
  const counts = new Map<string, number>()
  for (const r of rows) {
    const t = Date.parse(r.at)
    if (!Number.isFinite(t) || t > nowMs || t < today - (days - 1) * DAY) continue
    const k = pkDay(t)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (let i = days - 1; i >= 0; i--) {
    const k = pkDay(today - i * DAY)
    out.push({ day: k, count: counts.get(k) ?? 0 })
  }
  return out
}

export type TargetPace = { paid: number; target: number; left: number; daysLeft: number; perDay: number; reached: boolean }

/** "This month: N of 700" and the pace needed per remaining day (today
 *  included), rounded up to one decimal; 0 once the target is reached. */
export function targetPace(rows: PaidSignup[], nowMs: number, target = PAID_TARGET): TargetPace {
  const paid = countIn(rows, periodRange('this_month', nowMs))
  const next = pkMonthStart(nowMs, 1)
  const daysLeft = Math.max(1, Math.round((next - pkDayStart(nowMs)) / DAY))
  const left = Math.max(0, target - paid)
  const perDay = left === 0 ? 0 : Math.ceil((left / daysLeft) * 10) / 10
  return { paid, target, left, daysLeft, perDay, reached: left === 0 }
}

export type WhoRow = { id: string; name: string; count: number }

/** Who brought the paid sign-ups of a period: each staff member, then Self and
 *  Admin, largest first; zero rows left out. */
export function whoBrought(rows: PaidSignup[], range: { start: number; end: number }, names: Record<string, string>): WhoRow[] {
  const by = new Map<string, number>()
  for (const r of rows) {
    const t = Date.parse(r.at)
    if (!Number.isFinite(t) || t < range.start || t >= range.end) continue
    by.set(r.by, (by.get(r.by) ?? 0) + 1)
  }
  const label = (id: string) => (id === SELF_ID ? SELF_LABEL : id === ADMIN_ID ? ADMIN_LABEL : (names[id] ?? 'Staff'))
  const staff = [...by.entries()].filter(([id]) => id !== SELF_ID && id !== ADMIN_ID).map(([id, count]) => ({ id, name: label(id), count }))
  staff.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const tail = [SELF_ID, ADMIN_ID].filter((id) => by.has(id)).map((id) => ({ id, name: label(id), count: by.get(id) ?? 0 }))
  return [...staff, ...tail]
}

/** Who brought one paid tutor: the staff member credited, else Admin when a
 *  staff link's credit was refused under the rules (a self-referral), else Self. */
export function attributionOf(staffId: string | null | undefined, refusedToAdmin: boolean): string {
  if (staffId && staffId !== ADMIN_ID) return staffId
  return refusedToAdmin ? ADMIN_ID : SELF_ID
}

/** True when the payload carries anything that looks like money. The view's
 *  data must never: it is shown to roles that may not see rupees. */
export function carriesMoney(payload: unknown): boolean {
  return /"(amount|amount_pkr|price|price_pkr|pkr|revenue)"|\bRs\.?\s?\d/i.test(JSON.stringify(payload ?? null))
}

/** The Overview "Paid" card (owner, 10 Nov 2026): Today, Yesterday, Last 7 days
 *  (00:00 Pakistan time six days ago → now) and This month, counted over the
 *  SAME rows as the paid sign-ups view, so the card and the view always agree. */
export function paidCardCounts(rows: PaidSignup[], nowMs: number): { today: number; yesterday: number; last7: number; month: number } {
  return {
    today: countIn(rows, periodRange('today', nowMs)),
    yesterday: countIn(rows, periodRange('yesterday', nowMs)),
    last7: countIn(rows, { start: pkDayStart(nowMs) - 6 * DAY, end: nowMs + 1 }),
    month: countIn(rows, periodRange('this_month', nowMs)),
  }
}
