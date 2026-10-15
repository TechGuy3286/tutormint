// lib/staffTargetsCore.ts
//
// PURE, client-safe. Monthly paid sign-up targets (owner, 16 Oct 2026). The I/O
// half is lib/staffTargets.ts; the tests are scripts/test-staff-targets.ts.
//
// THE PAID RULE — one rule for the board, the team strip, the chart and staff
// pay figures. A credited account counts ONCE, on the day (Pakistan time) its
// first qualifying payment was approved:
//   • tutor  — an approved, not refunded Verification Fee (plan 'verified').
//              A free admin grant writes no payment row, so it never counts.
//   • parent — an approved, not refunded plan purchase (a 'parent_…' plan).
// A refunded payment stops counting, so the month it was in drops by one. It is
// computed from the payments as they are now — nothing is stored.
//
// Tutors and parents count together toward targets.
//
// THE TARGET LIST — the current and later months use the stored list
// (staff_target_list); a PAST month's list is the staff who have a target row
// for that month, so history keeps its own targets and results. Staff who are
// not on the list are "No target": their paid count is shown, never added to
// the team target or the team's paid number.

import type { CreditedAccount, MemberRole } from './staffSignupsCore'
import { change, type Change } from './tuitionPostingCore'

const DAY_MS = 86_400_000
const PK_OFFSET_MS = 5 * 3600_000

// ------------------------------------------------------------ the paid rule

export type PaymentFacts = {
  planCode: string | null
  status: string | null
  /** When it was approved (payments.reviewed_at). */
  approvedAt: string | null
  refundedAmountPkr?: number | null
  refundedAt?: string | null
}

/** Is this payment a qualifying paid sign-up for an account of this role? */
export function isQualifyingPayment(p: PaymentFacts, role: MemberRole): boolean {
  if (p.status !== 'approved' || !p.approvedAt || !Number.isFinite(Date.parse(p.approvedAt))) return false
  if ((Number(p.refundedAmountPkr) || 0) > 0 || p.refundedAt) return false
  const code = p.planCode ?? ''
  return role === 'tutor' ? code === 'verified' : code.startsWith('parent_')
}

/** The approval time of the FIRST qualifying payment, or null. */
export function firstPaidAt(payments: PaymentFacts[], role: MemberRole): string | null {
  let best: string | null = null
  for (const p of payments) {
    if (!isQualifyingPayment(p, role)) continue
    if (!best || Date.parse(p.approvedAt!) < Date.parse(best)) best = p.approvedAt
  }
  return best
}

// ------------------------------------------------------------ months

export type MonthKey = string // 'YYYY-MM'

/** The Pakistan-time calendar month `nowMs` falls in. */
export function monthKeyOf(nowMs: number): MonthKey {
  const d = new Date(nowMs + PK_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function isMonthKey(v: string | null | undefined): v is MonthKey {
  return !!v && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v)
}

export function parseMonth(v: string | null | undefined, nowMs: number): MonthKey {
  return isMonthKey(v) ? v : monthKeyOf(nowMs)
}

function ym(m: MonthKey): [number, number] {
  return [Number(m.slice(0, 4)), Number(m.slice(5, 7))]
}

/** [start, end) of a month, as UTC instants of Pakistan-time midnights. */
export function monthRange(m: MonthKey): { start: number; end: number } {
  const [y, mo] = ym(m)
  return { start: Date.UTC(y, mo - 1, 1) - PK_OFFSET_MS, end: Date.UTC(y, mo, 1) - PK_OFFSET_MS }
}

export function daysInMonth(m: MonthKey): number {
  const [y, mo] = ym(m)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

export function shiftMonth(m: MonthKey, by: number): MonthKey {
  const [y, mo] = ym(m)
  const d = new Date(Date.UTC(y, mo - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(m: MonthKey): string {
  const [y, mo] = ym(m)
  return `${MONTH_NAMES[mo - 1]} ${y}`
}

/** The month picker: next month, this month, and the 11 before it. */
export function pickerMonths(nowMs: number): MonthKey[] {
  const cur = monthKeyOf(nowMs)
  const out: MonthKey[] = [shiftMonth(cur, 1)]
  for (let i = 0; i < 12; i++) out.push(shiftMonth(cur, -i))
  return out
}

export type MonthTense = 'past' | 'current' | 'future'

export function monthTense(m: MonthKey, nowMs: number): MonthTense {
  const cur = monthKeyOf(nowMs)
  return m < cur ? 'past' : m > cur ? 'future' : 'current'
}

/** Days of the month gone, counting today's fraction (0 before, N after). */
export function elapsedDays(m: MonthKey, nowMs: number): number {
  const { start, end } = monthRange(m)
  if (nowMs <= start) return 0
  if (nowMs >= end) return daysInMonth(m)
  return (nowMs - start) / DAY_MS
}

/** Days left INCLUDING today (the last day = 1; a past month = 0; a future
 *  month = every day). */
export function daysLeft(m: MonthKey, nowMs: number): number {
  const { start, end } = monthRange(m)
  if (nowMs >= end) return 0
  if (nowMs < start) return daysInMonth(m)
  const dayIndex = Math.floor((nowMs - start) / DAY_MS) // 0 on the 1st
  return daysInMonth(m) - dayIndex
}

// ------------------------------------------------------------ pace

export type PaceStatus = 'on_pace' | 'slightly_behind' | 'behind'

export const PACE_LABEL: Record<PaceStatus, string> = {
  on_pace: 'On pace',
  slightly_behind: 'Slightly behind',
  behind: 'Behind',
}

export type Pace = {
  target: number | null
  paid: number
  /** paid ÷ target, as a whole percent; null with no target. */
  pct: number | null
  /** target × elapsed ÷ days in month. */
  expected: number | null
  status: PaceStatus | null
  reached: boolean
  daysLeft: number
  /** (target − paid) ÷ days left including today, one decimal, rounded up; 0
   *  when reached; null with no target or no days left. */
  neededPerDay: number | null
}

export function paceFor(target: number | null | undefined, paid: number, m: MonthKey, nowMs: number): Pace {
  const left = daysLeft(m, nowMs)
  if (target == null || target <= 0) {
    return { target: target ?? null, paid, pct: null, expected: null, status: null, reached: false, daysLeft: left, neededPerDay: null }
  }
  const expected = (target * elapsedDays(m, nowMs)) / daysInMonth(m)
  const reached = paid >= target
  let status: PaceStatus
  if (reached || expected <= 0) status = 'on_pace'
  else {
    const ratio = paid / expected
    status = ratio >= 1 ? 'on_pace' : ratio >= 0.8 ? 'slightly_behind' : 'behind'
  }
  const neededPerDay = reached ? 0 : left > 0 ? Math.ceil(((target - paid) / left) * 10) / 10 : null
  return { target, paid, pct: Math.round((paid / target) * 100), expected, status, reached, daysLeft: left, neededPerDay }
}

// ------------------------------------------------------------ counting

function inRange(iso: string | null | undefined, r: { start: number; end: number }): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= r.start && t < r.end
}

/** Accounts whose qualifying payment falls in the month — tutors and parents. */
export function paidInMonth(accounts: CreditedAccount[], m: MonthKey): CreditedAccount[] {
  const r = monthRange(m)
  return accounts.filter((a) => inRange(a.at.paid, r))
}

/** Today so far, all of yesterday, and today against yesterday up to the same
 *  time of day (the comparison the board already uses). */
export function todayYesterday(accounts: CreditedAccount[], nowMs: number): { today: number; yesterday: number; change: Change } {
  const local = nowMs + PK_OFFSET_MS
  const todayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - PK_OFFSET_MS
  const today = accounts.filter((a) => inRange(a.at.paid, { start: todayStart, end: nowMs + 1 })).length
  const yesterday = accounts.filter((a) => inRange(a.at.paid, { start: todayStart - DAY_MS, end: todayStart })).length
  const sameTime = accounts.filter((a) => inRange(a.at.paid, { start: todayStart - DAY_MS, end: nowMs - DAY_MS + 1 })).length
  return { today, yesterday, change: change(today, sameTime) }
}

/** Running total of paid sign-ups at the END of each day of the month; null
 *  for days that have not started yet. */
export function cumulativeByDay(accounts: CreditedAccount[], m: MonthKey, nowMs: number): (number | null)[] {
  const { start } = monthRange(m)
  const n = daysInMonth(m)
  const out: (number | null)[] = []
  const times = paidInMonth(accounts, m)
    .map((a) => Date.parse(a.at.paid!))
    .sort((a, b) => a - b)
  let i = 0
  for (let d = 0; d < n; d++) {
    const dayStart = start + d * DAY_MS
    if (dayStart > nowMs) {
      out.push(null)
      continue
    }
    const dayEnd = dayStart + DAY_MS
    while (i < times.length && times[i] < dayEnd) i++
    out.push(i)
  }
  return out
}

/** The straight target line: target × day ÷ days in month, day 1…N. */
export function targetLine(target: number, m: MonthKey): number[] {
  const n = daysInMonth(m)
  return Array.from({ length: n }, (_, d) => Math.round(((target * (d + 1)) / n) * 10) / 10)
}

// ------------------------------------------------------------ the list

/**
 * Who is on the target list for a month: the stored list for the current and
 * later months; for a past month, the staff with a target row for it.
 */
export function targetListFor(
  m: MonthKey,
  nowMs: number,
  storedList: Set<string>,
  targetsForMonth: Map<string, number>,
): Set<string> {
  return monthTense(m, nowMs) === 'past' ? new Set(targetsForMonth.keys()) : new Set(storedList)
}

/** Highest % of target first; no target set last; then by name. */
export function sortCards<T extends { name: string; pace: Pace }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const pa = a.pace.pct ?? -1
    const pb = b.pace.pct ?? -1
    return pb - pa || b.pace.paid - a.pace.paid || a.name.localeCompare(b.name)
  })
}

// ------------------------------------------------------------ who sees what

/**
 *   everyone     Owner, Project Managers, Admin — every card, the team, the chart.
 *   target_self  a staff member on this month's target list — their own card,
 *                own chart line, own in-progress lists and the team status chip.
 *   self         anyone else — their own paid count and in-progress lists only.
 */
export type TargetScope = 'everyone' | 'target_self' | 'self'

export function targetScope(adminRole: string | null | undefined, onListThisMonth: boolean): TargetScope {
  if (adminRole === 'owner' || adminRole === 'partner' || adminRole === 'admin') return 'everyone'
  return onListThisMonth ? 'target_self' : 'self'
}

/** Only the Owner sets targets or changes the list. */
export function mayManageTargets(adminRole: string | null | undefined): boolean {
  return adminRole === 'owner'
}

export const OWNER_ONLY_TARGETS = 'Only the Owner can set targets. Your account can view this.'

// ------------------------------------------------------------ input

export const TARGET_MAX = 10000

/** One target from a form value: a whole number 0…10000, or null for "leave
 *  as it is" (an empty box). Anything else is an error. */
export function parseTargetValue(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isInteger(n) || n < 0 || n > TARGET_MAX) return { ok: false }
  return { ok: true, value: n }
}

/** "1.5" / "2" — one decimal only when needed. */
export function perDayLabel(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
