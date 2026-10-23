// lib/staffSignupsCore.ts
//
// PURE, client-safe. Sign-ups by staff (owner, 15 Oct 2026): who brought whom.
//
//   • Every staff member whose role includes tuition work — Tuitions staff,
//     Operations and Admin — is a PARTICIPANT with a personal join link
//     (/join/<slug>) and a short code. A role given later is included
//     automatically; a removed or paused staff member keeps past credits and
//     earns no new ones.
//   • Opening the link stores a first-touch credit for 30 days (cookie + a
//     server record). A later, different link does not replace a credit that is
//     still valid. The optional "Staff code" on /register gives credit only when
//     there is no valid credit already.
//   • The credit is attached to the account when it is created. One credit per
//     account, ever.
//   • A sign-up that came without a link can be CLAIMED (mobile or email + a
//     note) within 30 days of signing up; the Owner or Admin approves.
//   • No credit for: an account that existed before the link was opened, a
//     staff / test account, a staff member's own mobile or email, or an account
//     that duplicates an existing member.
//
// The I/O half is lib/staffSignups.ts.

import { pktDayStartMs, change, type Change } from './tuitionPostingCore'
import { pkMonthStartMs } from './feePayersCore'

export const STAFF_REF_COOKIE = 'tm_staff_ref'
export const CREDIT_DAYS = 30
export const CREDIT_MS = CREDIT_DAYS * 86_400_000
/** How long after signing up an account can still be claimed. */
export const CLAIM_WINDOW_DAYS = 30
export const CLAIM_WINDOW_MS = CLAIM_WINDOW_DAYS * 86_400_000

/** Roles that take part (owner, 15 Oct 2026). The Owner and the Project
 *  Managers manage the board; they do not carry a join link. */
export const PARTICIPANT_ROLES = ['tuitions_staff', 'operations', 'supervisor', 'admin'] as const

export function isParticipantRole(role: string | null | undefined): boolean {
  return !!role && (PARTICIPANT_ROLES as readonly string[]).includes(role)
}

/** A staff member earns NEW credits only while they hold a participating role
 *  and are not paused. */
export function isActiveParticipant(s: { role?: string | null; adminRole: string | null; suspended?: boolean | null }): boolean {
  if (s.role != null && s.role !== 'admin') return false
  return isParticipantRole(s.adminRole) && !s.suspended
}

// ---------------------------------------------------------------- link + code

/** The first name, letters and digits only, lower-cased ("Aseer Ul Hassan" →
 *  "aseer"). Never a mobile, email or any other personal detail. */
export function slugBase(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  const base = first
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return base.length >= 2 ? base.slice(0, 20) : 'staff'
}

/** A free slug: the base, then base2, base3… */
export function pickSlug(fullName: string | null | undefined, taken: Set<string>): string {
  const base = slugBase(fullName)
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const s = `${base}${i}`
    if (!taken.has(s)) return s
  }
  return `${base}${Date.now() % 100000}`
}

/** The code is the slug in capitals ("aseer" → "ASEER"). */
export function codeForSlug(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** What a member types in the Staff code box, made comparable: capitals, no
 *  spaces or dashes. Empty → null. */
export function normaliseStaffCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return v.length >= 2 && v.length <= 24 ? v : null
}

/** A slug from the URL, made comparable; null for anything that is not one. */
export function normaliseSlug(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  return /^[a-z0-9-]{2,32}$/.test(v) ? v : null
}

export function joinPath(slug: string): string {
  return `/join/${slug}`
}

// ---------------------------------------------------------------- the credit

export type Visit = { id: string; staffId: string; createdAt: string; expiresAt: string }

/** Is a stored first-touch credit still good? */
export function visitValid(v: Visit | null | undefined, nowMs: number): boolean {
  if (!v) return false
  const exp = Date.parse(v.expiresAt)
  return Number.isFinite(exp) && exp > nowMs
}

/**
 * Opening a join link: keep a credit that is still valid (first link wins),
 * otherwise record a new one for this staff member.
 */
export function onJoinLink(existing: Visit | null, nowMs: number): 'keep' | 'record' {
  return visitValid(existing, nowMs) ? 'keep' : 'record'
}

/** Typing a staff code at sign-up: only when there is no valid credit. */
export function onStaffCode(existing: Visit | null, codeValid: boolean, nowMs: number): 'keep' | 'record' | 'ignore' {
  if (visitValid(existing, nowMs)) return 'keep'
  return codeValid ? 'record' : 'ignore'
}

export function visitExpiry(nowMs: number): string {
  return new Date(nowMs + CREDIT_MS).toISOString()
}

/** The facts about an account that decide whether it may be credited. */
export type AccountFacts = {
  id: string
  role: string | null
  createdAt: string
  /** Normalised mobile / WhatsApp numbers (92…) on the account. */
  mobiles: string[]
  email: string | null
  isTest: boolean
  /** A linked second-role account, or an older account shares its number or email. */
  isDuplicate: boolean
  alreadyCredited: boolean
}

/** Mobiles and emails of every staff account (lower-cased emails). */
export type StaffContacts = { mobiles: Set<string>; emails: Set<string> }

export type CreditRefusal =
  | 'not_member'
  | 'test'
  | 'staff_contact'
  | 'duplicate'
  | 'already_credited'
  | 'before_link'
  | 'too_old'

export const REFUSAL_WORDS: Record<CreditRefusal, string> = {
  not_member: 'That account is not a tutor or parent account.',
  test: 'Test and staff accounts are not credited.',
  staff_contact: 'That mobile or email belongs to a staff member.',
  duplicate: 'That account duplicates an existing member.',
  already_credited: 'That account is already credited to someone.',
  before_link: 'That account existed before the link was opened.',
  too_old: `Only accounts that signed up in the last ${CLAIM_WINDOW_DAYS} days can be claimed.`,
}

/** Shared rules for every way of giving credit. Null = may be credited. */
export function creditRefusal(a: AccountFacts, staff: StaffContacts): CreditRefusal | null {
  if (a.role !== 'tutor' && a.role !== 'parent') return 'not_member'
  if (a.isTest) return 'test'
  const email = (a.email ?? '').trim().toLowerCase()
  if (a.mobiles.some((m) => staff.mobiles.has(m)) || (email && staff.emails.has(email))) return 'staff_contact'
  if (a.isDuplicate) return 'duplicate'
  if (a.alreadyCredited) return 'already_credited'
  return null
}

/** A sign-up with a stored credit: the account must be newer than the visit
 *  (a minute of slack for clock differences). */
export function linkCreditRefusal(a: AccountFacts, visit: Visit, staff: StaffContacts): CreditRefusal | null {
  const base = creditRefusal(a, staff)
  if (base) return base
  const made = Date.parse(a.createdAt)
  const opened = Date.parse(visit.createdAt)
  if (Number.isFinite(made) && Number.isFinite(opened) && made < opened - 60_000) return 'before_link'
  return null
}

/** A claim: the account signed up in the last 30 days and has no credit. */
export function claimRefusal(a: AccountFacts, staff: StaffContacts, nowMs: number): CreditRefusal | null {
  const base = creditRefusal(a, staff)
  if (base) return base
  const made = Date.parse(a.createdAt)
  if (!Number.isFinite(made) || nowMs - made > CLAIM_WINDOW_MS) return 'too_old'
  return null
}

/** The Owner or Admin decides; nobody approves their own claim. */
export function mayDecideClaim(actorId: string, claimantId: string): boolean {
  return actorId !== claimantId
}

// --------------------------------------------------------- the milestones

export type MemberRole = 'tutor' | 'parent'
export type TutorStep = 'signed_up' | 'mobile_verified' | 'onboarded' | 'paid'
export type ParentStep = 'signed_up' | 'mobile_verified' | 'posted'
export type Step = TutorStep | ParentStep

export const TUTOR_STEPS: { key: TutorStep; label: string }[] = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'mobile_verified', label: 'Mobile verified' },
  { key: 'onboarded', label: 'Onboarded' },
  { key: 'paid', label: 'Paid' },
]
export const PARENT_STEPS: { key: ParentStep; label: string }[] = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'mobile_verified', label: 'Mobile verified' },
  { key: 'posted', label: 'Posted a tuition' },
]

export function stepsFor(role: MemberRole): { key: Step; label: string }[] {
  return role === 'tutor' ? TUTOR_STEPS : PARENT_STEPS
}

export function isStep(role: MemberRole, v: string | null | undefined): v is Step {
  return stepsFor(role).some((s) => s.key === v)
}

/** One credited account and when it reached each step (ISO or null). */
export type CreditedAccount = {
  memberId: string
  staffId: string
  role: MemberRole
  name: string
  mobile: string | null
  at: Partial<Record<Step, string | null>>
  /** How the credit was given (link, the old code box, an approved claim, or
   *  'direct' — no valid staff link, credited to Admin). */
  source?: 'link' | 'code' | 'claim' | 'direct'
}

/** The furthest step reached, in words. */
export function currentStep(a: CreditedAccount): string {
  const steps = stepsFor(a.role)
  let label = 'Signed up'
  for (const s of steps) if (a.at[s.key]) label = s.label
  // A parent who bought a plan has paid (owner, 16 Oct 2026).
  if (a.role === 'parent' && a.at.paid) label = 'Paid'
  return label
}

export type Period = 'today' | 'yesterday' | 'last7' | 'month'
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
]

export function parsePeriod(v: string | null | undefined): Period {
  return PERIODS.some((p) => p.key === v) ? (v as Period) : 'today'
}

const DAY_MS = 86_400_000

/** [start, end) of a period in Pakistan time. */
export function periodRange(p: Period, nowMs: number): { start: number; end: number } {
  const today = pktDayStartMs(nowMs)
  switch (p) {
    case 'today':
      return { start: today, end: nowMs + 1 }
    case 'yesterday':
      return { start: today - DAY_MS, end: today }
    case 'last7':
      return { start: today - 6 * DAY_MS, end: nowMs + 1 }
    case 'month':
      return { start: pkMonthStartMs(nowMs), end: nowMs + 1 }
  }
}

function inRange(iso: string | null | undefined, r: { start: number; end: number }): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= r.start && t < r.end
}

/** The accounts that reached `step` inside the period — the ONE rule the board
 *  numbers and the lists behind them both use. A step counts on the day it
 *  happened (Pakistan time). */
export function accountsAt(accounts: CreditedAccount[], step: Step, period: Period, nowMs: number): CreditedAccount[] {
  const r = periodRange(period, nowMs)
  return accounts.filter((a) => inRange(a.at[step], r))
}

/** Paid today so far against yesterday up to the same time of day. */
export function paidTodayVsYesterday(accounts: CreditedAccount[], nowMs: number): Change {
  const today = pktDayStartMs(nowMs)
  const sameTime = { start: today - DAY_MS, end: nowMs - DAY_MS + 1 }
  const now = accounts.filter((a) => a.role === 'tutor' && inRange(a.at.paid, { start: today, end: nowMs + 1 })).length
  const before = accounts.filter((a) => a.role === 'tutor' && inRange(a.at.paid, sameTime)).length
  return change(now, before)
}

// "In progress (not counted)" (owner, 15 Oct 2026): staff are paid for PAID
// tutor sign-ups only. A tutor who reached an earlier step in the period and has
// NOT paid (at any time) is in progress — never in the Paid number, and a tutor
// who has paid is never in progress.
export type InProgressStep = Exclude<TutorStep, 'paid'>
export const IN_PROGRESS_STEPS: { key: InProgressStep; label: string }[] = TUTOR_STEPS.filter(
  (s): s is { key: InProgressStep; label: string } => s.key !== 'paid',
)

export function isInProgressStep(v: string | null | undefined): v is InProgressStep {
  return IN_PROGRESS_STEPS.some((s) => s.key === v)
}

/** Tutors who reached `step` in the period and have not paid. The ONE rule for
 *  the in-progress numbers and the lists behind them. */
export function inProgressAt(accounts: CreditedAccount[], step: InProgressStep, period: Period, nowMs: number): CreditedAccount[] {
  return accountsAt(
    accounts.filter((a) => a.role === 'tutor' && !a.at.paid),
    step,
    period,
    nowMs,
  )
}

// Monthly targets (owner, 16 Oct 2026): the lists behind a card can be for any
// date range (a calendar month), and "in progress" covers parents too —
// Signed up and Posted a tuition, not paid yet (a parent plan purchase is a
// parent's paid sign-up; lib/staffTargetsCore firstPaidAt).
export type Range = { start: number; end: number }

export const PARENT_IN_PROGRESS_STEPS: { key: ParentStep; label: string }[] = PARENT_STEPS.filter((s) => s.key !== 'mobile_verified')

export function inProgressStepsFor(role: MemberRole): { key: Step; label: string }[] {
  return role === 'tutor' ? IN_PROGRESS_STEPS : PARENT_IN_PROGRESS_STEPS
}

export function isInProgressStepFor(role: MemberRole, v: string | null | undefined): v is Step {
  return inProgressStepsFor(role).some((s) => s.key === v)
}

/** A step a list may be opened for: the role's steps, and Paid for parents too. */
export function isListStep(role: MemberRole, v: string | null | undefined): v is Step {
  return isStep(role, v) || v === 'paid'
}

export function accountsInRange(accounts: CreditedAccount[], step: Step, r: Range): CreditedAccount[] {
  return accounts.filter((a) => inRange(a.at[step], r))
}

/** Accounts of `role` that reached `step` in the range and have not paid. */
export function inProgressIn(accounts: CreditedAccount[], role: MemberRole, step: Step, r: Range): CreditedAccount[] {
  return accountsInRange(
    accounts.filter((a) => a.role === role && !a.at.paid),
    step,
    r,
  )
}

export type BoardRow = {
  staffId: string
  name: string
  tutor: Record<TutorStep, number>
  parent: Record<ParentStep, number>
  /** Tutors at an earlier step who have not paid — never part of `tutor.paid`. */
  inProgress: Record<InProgressStep, number>
  paidChange: Change
}

export function boardRow(staffId: string, name: string, accounts: CreditedAccount[], period: Period, nowMs: number): BoardRow {
  const tutors = accounts.filter((a) => a.role === 'tutor')
  const parents = accounts.filter((a) => a.role === 'parent')
  const t = {} as Record<TutorStep, number>
  for (const s of TUTOR_STEPS) t[s.key] = accountsAt(tutors, s.key, period, nowMs).length
  const p = {} as Record<ParentStep, number>
  for (const s of PARENT_STEPS) p[s.key] = accountsAt(parents, s.key, period, nowMs).length
  const ip = {} as Record<InProgressStep, number>
  for (const s of IN_PROGRESS_STEPS) ip[s.key] = inProgressAt(tutors, s.key, period, nowMs).length
  return { staffId, name, tutor: t, parent: p, inProgress: ip, paidChange: paidTodayVsYesterday(tutors, nowMs) }
}

/** Highest Paid first (the number staff are paid for), then onboarded, signed
 *  up, then by name. */
export function sortBoardRows(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort(
    (a, b) =>
      b.tutor.paid - a.tutor.paid ||
      b.tutor.onboarded - a.tutor.onboarded ||
      b.tutor.signed_up - a.tutor.signed_up ||
      b.parent.signed_up - a.parent.signed_up ||
      a.name.localeCompare(b.name),
  )
}

// --------------------------------------------------------- who sees what

/** Owner, Project Managers and Admin see everyone and the Team total; every
 *  other participant sees only their own row and lists. */
export function seesEveryone(adminRole: string | null | undefined): boolean {
  return adminRole === 'owner' || adminRole === 'partner' || adminRole === 'admin'
}

/** May this viewer open the lists for `staffId` ('team' = everyone)? */
export function mayViewStaff(viewer: { id: string; adminRole: string | null }, staffId: string): boolean {
  if (seesEveryone(viewer.adminRole)) return true
  return staffId === viewer.id
}

// --------------------------------------------------------- templates

/** Fill {join_link}. Staff with no link of their own (the Owner, a Project
 *  Manager) send the plain sign-up page. */
export function fillJoinLink(body: string, joinLink: string | null | undefined, fallback: string): string {
  return body.replace(/\{join_link\}/g, joinLink || fallback)
}

// Team activity → "Pending / Signed up" (owner, 16 Oct 2026). On that page the
// earlier steps collapse to two statuses, so an unpaid person never reads as a
// result:
//   Pending    attributed, NOT paid (at any time), and active in the range —
//              signed up, or reached any later step, inside it;
//   Signed up  attributed and PAID in the range (`at.paid`, the first approved,
//              not refunded Verification Fee for a tutor / plan purchase for a
//              parent — lib/staffTargetsCore firstPaidAt, the rule the
//              dashboard's "Paid today" uses for tutors).
// The step concepts (Mobile verified, Onboarded, Posted) are unchanged
// everywhere else.
export type StaffStatus = 'pending' | 'signed_up'

export function isStaffStatus(v: string | null | undefined): v is StaffStatus {
  return v === 'pending' || v === 'signed_up'
}

const PENDING_STEPS: Step[] = ['signed_up', 'mobile_verified', 'onboarded', 'posted']

export function pendingIn(accounts: CreditedAccount[], role: MemberRole, r: Range): CreditedAccount[] {
  return accounts.filter((a) => a.role === role && !a.at.paid && PENDING_STEPS.some((s) => inRange(a.at[s], r)))
}

export function signedUpIn(accounts: CreditedAccount[], role: MemberRole, r: Range): CreditedAccount[] {
  return accounts.filter((a) => a.role === role && inRange(a.at.paid, r))
}

export function statusIn(accounts: CreditedAccount[], role: MemberRole, status: StaffStatus, r: Range): CreditedAccount[] {
  return status === 'pending' ? pendingIn(accounts, role, r) : signedUpIn(accounts, role, r)
}

/** Pending per role for one range — the ONE count behind Team activity's
 *  status counts AND the "Pending (unpaid)" line on each target card
 *  (owner, 17 Oct 2026), so the two can never disagree. */
export function pendingSplit(accounts: CreditedAccount[], r: Range): { tutors: number; parents: number } {
  return { tutors: pendingIn(accounts, 'tutor', r).length, parents: pendingIn(accounts, 'parent', r).length }
}

/** Every attributed person who has not paid, whenever they were last active —
 *  the follow-up backlog ("All unpaid" on a target card). */
export function allUnpaid(accounts: CreditedAccount[]): CreditedAccount[] {
  return accounts.filter((a) => !a.at.paid)
}

// ---------------------------------------------------------- staff links
//
// Staff links with a hidden code (owner, 23 Oct 2026). Any tutormint.org page
// opened with ?ref=<code> stores a first-touch credit (the same visit and
// httpOnly cookie as /join/<slug>), and the address bar is cleaned. The
// personal link is /join?ref=<code>; the Staff code box is gone from /register.

export const REF_PARAM = 'ref'

/** The personal link's path: /join?ref=AQSA. */
export function joinRefPath(code: string): string {
  return `/join?${REF_PARAM}=${encodeURIComponent(code.toUpperCase())}`
}

/** The ref in a query string (any case of the value; the name is "ref"). */
export function refFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return normaliseStaffCode(params.get(REF_PARAM))
}

/** The address with ?ref removed (other parameters and the #fragment kept). */
export function withoutRef(pathname: string, search: string, hash = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete(REF_PARAM)
  const q = params.toString()
  return `${pathname}${q ? `?${q}` : ''}${hash}`
}

export type MyLinkCounts = {
  last7: { tutors: number; parents: number; tutorsPaid: number }
  last30: { tutors: number; parents: number; tutorsPaid: number }
}

/** [start, end) of the last N days in Pakistan time, today included. */
export function lastDaysRange(days: number, nowMs: number): Range {
  return { start: pktDayStartMs(nowMs) - (days - 1) * DAY_MS, end: nowMs + 1 }
}

/** The "My link" card's numbers for one staff member: sign-ups by the day they
 *  signed up, tutors who paid by the day they paid. */
export function myLinkCounts(accounts: CreditedAccount[], staffId: string, nowMs: number): MyLinkCounts {
  const mine = accounts.filter((a) => a.staffId === staffId)
  const count = (days: number) => {
    const r = lastDaysRange(days, nowMs)
    return {
      tutors: mine.filter((a) => a.role === 'tutor' && inRange(a.at.signed_up, r)).length,
      parents: mine.filter((a) => a.role === 'parent' && inRange(a.at.signed_up, r)).length,
      tutorsPaid: mine.filter((a) => a.role === 'tutor' && inRange(a.at.paid, r)).length,
    }
  }
  return { last7: count(7), last30: count(30) }
}

export type CreditSource = 'link' | 'code' | 'claim' | 'direct'

/** The staffId of sign-ups credited to Admin (no valid staff link). */
export const ADMIN_STAFF_ID = 'admin'
export const ADMIN_DIRECT_NAME = 'Admin (direct)'

/**
 * Claiming a sign-up that came without a link is closed (owner, 24 Oct 2026):
 * such a sign-up is credited to Admin. Claims already made stay in Claims to
 * review unchanged.
 */
export const CLAIMS_OPEN = false
export const CLAIMS_CLOSED = 'Claims are closed. A sign-up without a staff link is credited to Admin.'

export type SourceRow = {
  staffId: string
  name: string
  link: number
  code: number
  claim: number
  /** Sign-ups with no valid staff link, credited to Admin (the Admin row only). */
  direct: number
  total: number
  paid7: number
  paid30: number
  paidAll: number
}

/** Sign-ups by source (all time) and tutors paid (7 / 30 days / all time) for
 *  one staff member. */
export function sourceRow(staffId: string, name: string, accounts: CreditedAccount[], nowMs: number): SourceRow {
  const mine = staffId === 'team' ? accounts : accounts.filter((a) => a.staffId === staffId)
  const by = (s: CreditSource) => mine.filter((a) => (a.source ?? 'link') === s).length
  const paid = (r: Range | null) => mine.filter((a) => a.role === 'tutor' && a.at.paid && (!r || inRange(a.at.paid, r))).length
  return {
    staffId,
    name,
    link: by('link'),
    code: by('code'),
    claim: by('claim'),
    direct: by('direct'),
    total: mine.length,
    paid7: paid(lastDaysRange(7, nowMs)),
    paid30: paid(lastDaysRange(30, nowMs)),
    paidAll: paid(null),
  }
}

/** The cookie that holds the stored credit's id (first-party, httpOnly, 30 days). */
export function staffRefCookieOptions(): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number } {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.floor(CREDIT_MS / 1000) }
}
