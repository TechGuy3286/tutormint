import 'server-only'

// lib/staffTargets.ts
//
// Monthly paid sign-up targets (owner, 16 Oct 2026) — the I/O half. The rules
// are pure in lib/staffTargetsCore.ts. Service role throughout: the two tables
// (migration 177) have a staff-read policy and no write policy. Every change is
// written to admin_audit_log. Who may set targets is checked by the route
// (Owner only, with the blocked-attempt alert); who sees what is decided HERE,
// on the server, so a staff member never receives another person's numbers.

import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAccessCore'
import { ensureJoinLinks, loadCreditedAccounts, type JoinLink } from '@/lib/staffSignups'
import {
  inProgressIn,
  pendingSplit,
  signedUpIn,
  isParticipantRole,
  mayViewStaff,
  type CreditedAccount,
  type MemberRole,
} from '@/lib/staffSignupsCore'
import {
  countingFromLabel,
  countingStartDate,
  cumulativeByDay,
  daysInMonth,
  defaultCountingStart,
  monthRange,
  monthTense,
  cardFigures,
  paceFor,
  paidInMonth,
  pickerMonths,
  shiftMonth,
  sortCards,
  targetLine,
  targetListFor,
  targetScope,
  todayYesterday,
  type MonthKey,
  type MonthTense,
  type Pace,
  type PaceStatus,
  type TargetScope,
} from '@/lib/staffTargetsCore'
import type { Change } from '@/lib/tuitionPostingCore'

type Viewer = { id: string; adminRole: string | null }

export type TargetCard = {
  staffId: string
  name: string
  pace: Pace
  tutors: number
  parents: number
  today: number
  yesterday: number
  change: Change
  /** "Pending (unpaid)" this month — the status counts' rule; never in the pace. */
  pending: { tutors: number; parents: number }
  /** "All unpaid": every attributed person not paid, any month. */
  allUnpaid: number
}

export type InProgressCounts = {
  staffId: string
  name: string
  tutor: { signed_up: number; mobile_verified: number; onboarded: number }
  parent: { signed_up: number; posted: number }
}

/** Team activity's two statuses per staff member (owner, 16 Oct 2026):
 *  Pending = attributed, not paid; Signed up = paid in the month
 *  (lib/staffSignupsCore pendingIn / signedUpIn). */
export type StatusCounts = {
  staffId: string
  name: string
  tutor: { pending: number; signed_up: number }
  parent: { pending: number; signed_up: number }
}

export type ChartLine = { staffId: string; name: string; values: (number | null)[]; target: number[] | null }

export type TargetBoard = {
  month: MonthKey
  months: MonthKey[]
  tense: MonthTense
  scope: TargetScope
  /** The month's "Counting starts" date, 'YYYY-MM-DD' (the 1st by default). */
  countingStarts: string
  /** "Counting from 15 Oct" — null when counting starts on the 1st. */
  countingFrom: string | null
  /** The team strip (everyone scope only). */
  team: Pace | null
  /** The team status chip — everyone and target-list staff. */
  teamStatus: PaceStatus | null
  teamReached: boolean
  cards: TargetCard[]
  noTarget: { staffId: string; name: string; paid: number; tutors: number; parents: number }[]
  /** "self" scope: their own paid count. */
  ownPaid: { paid: number; tutors: number; parents: number } | null
  inProgress: InProgressCounts[]
  /** The same people as `inProgress` (same scope cut), as Pending / Signed up. */
  statusCounts: StatusCounts[]
  chart: { days: number; team: (number | null)[] | null; teamTarget: number[] | null; people: ChartLine[] } | null
  /** The Owner's "Set targets" panel; null for everyone else. */
  setPanel: { staffId: string; name: string; onList: boolean; target: number | null; lastMonth: number | null }[] | null
  myLink: JoinLink | null
}

type StaffRow = { id: string; name: string; adminRole: string | null; suspended: boolean }

async function loadStaff(): Promise<StaffRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin.from('profiles').select('id, full_name, email, admin_role, is_suspended').eq('role', 'admin')
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: formatName((s.full_name as string | null) ?? '') || (s.email as string | null) || '—',
    adminRole: (s.admin_role as string | null) ?? null,
    suspended: !!s.is_suspended,
  }))
}

/** The stored list (staff ids with on_list = true). */
async function loadStoredList(): Promise<Set<string>> {
  const admin = createAdminClient()
  if (!admin) return new Set()
  const { data } = await admin.from('staff_target_list').select('staff_id, on_list')
  return new Set((data ?? []).filter((r) => r.on_list).map((r) => r.staff_id as string))
}

async function loadTargets(month: MonthKey): Promise<Map<string, number>> {
  const admin = createAdminClient()
  if (!admin) return new Map()
  const { data } = await admin.from('staff_monthly_targets').select('staff_id, target').eq('month', month)
  return new Map((data ?? []).map((r) => [r.staff_id as string, Number(r.target)]))
}

/** The month's "Counting starts" date (migration 179), clamped into the month.
 *  Tolerant: no table, no row or a failed read → the 1st. */
export async function loadCountingStart(month: MonthKey): Promise<string> {
  const admin = createAdminClient()
  if (!admin) return defaultCountingStart(month)
  try {
    const { data, error } = await admin.from('staff_target_months').select('counting_starts').eq('month', month).maybeSingle()
    if (error || !data) return defaultCountingStart(month)
    return countingStartDate(month, String(data.counting_starts ?? '').slice(0, 10))
  } catch {
    return defaultCountingStart(month)
  }
}

function split(accounts: CreditedAccount[]): { tutors: number; parents: number } {
  return { tutors: accounts.filter((a) => a.role === 'tutor').length, parents: accounts.filter((a) => a.role === 'parent').length }
}

function inProgressCounts(staffId: string, name: string, mine: CreditedAccount[], month: MonthKey): InProgressCounts {
  const r = monthRange(month)
  const n = (role: MemberRole, step: 'signed_up' | 'mobile_verified' | 'onboarded' | 'posted') => inProgressIn(mine, role, step, r).length
  return {
    staffId,
    name,
    tutor: { signed_up: n('tutor', 'signed_up'), mobile_verified: n('tutor', 'mobile_verified'), onboarded: n('tutor', 'onboarded') },
    parent: { signed_up: n('parent', 'signed_up'), posted: n('parent', 'posted') },
  }
}

function statusCounts(staffId: string, name: string, mine: CreditedAccount[], month: MonthKey): StatusCounts {
  const r = monthRange(month)
  const pending = pendingSplit(mine, r)
  return {
    staffId,
    name,
    tutor: { pending: pending.tutors, signed_up: signedUpIn(mine, 'tutor', r).length },
    parent: { pending: pending.parents, signed_up: signedUpIn(mine, 'parent', r).length },
  }
}

function anyStatus(r: StatusCounts): boolean {
  return [...Object.values(r.tutor), ...Object.values(r.parent)].some((v) => v > 0)
}

function anyInProgress(r: InProgressCounts): boolean {
  return [...Object.values(r.tutor), ...Object.values(r.parent)].some((v) => v > 0)
}

/**
 * The Paid sign-ups board for one month, already cut to what this viewer may
 * see. `onlyStaff` narrows it to one staff member (the API's ?staff=); the
 * caller has already checked mayViewStaff.
 */
export async function loadTargetBoard(viewer: Viewer, month: MonthKey, nowMs = Date.now(), onlyStaff?: string | null): Promise<TargetBoard> {
  const [staff, accounts, stored, targets, lastTargets, links, countingStarts] = await Promise.all([
    loadStaff(),
    loadCreditedAccounts(),
    loadStoredList(),
    loadTargets(month),
    loadTargets(shiftMonth(month, -1)),
    ensureJoinLinks(),
    loadCountingStart(month),
  ])
  const tense = monthTense(month, nowMs)
  const list = targetListFor(month, nowMs, stored, targets)
  const scope = targetScope(viewer.adminRole, list.has(viewer.id))
  const byStaff = new Map<string, CreditedAccount[]>()
  for (const a of accounts) {
    const l = byStaff.get(a.staffId) ?? []
    l.push(a)
    byStaff.set(a.staffId, l)
  }
  const nameOf = new Map(staff.map((s) => [s.id, s.name]))
  const mineOf = (id: string) => byStaff.get(id) ?? []

  // Cards and the team: target-list staff only.
  const listIds = [...list].filter((id) => nameOf.has(id))
  const cardFor = (id: string): TargetCard => ({
    staffId: id,
    name: nameOf.get(id) ?? '—',
    ...cardFigures(mineOf(id), month, targets.get(id) ?? null, nowMs, countingStarts, tense === 'current'),
  })
  const allCards = sortCards(listIds.map(cardFor))
  const teamTarget = listIds.reduce((s, id) => s + (targets.get(id) ?? 0), 0)
  const teamPaid = allCards.reduce((s, c) => s + c.pace.paid, 0)
  const teamPace = paceFor(teamTarget > 0 ? teamTarget : null, teamPaid, month, nowMs, countingStarts)
  const teamAccounts = accounts.filter((a) => list.has(a.staffId))

  // No target: anyone else with paid sign-ups this month.
  const noTarget = [...byStaff.keys()]
    .filter((id) => !list.has(id))
    .map((id) => {
      const paid = paidInMonth(mineOf(id), month)
      return { staffId: id, name: nameOf.get(id) ?? '—', paid: paid.length, ...split(paid) }
    })
    .filter((r) => r.paid > 0)
    .sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name))

  // In progress: participants and anyone with credits.
  const ipIds = new Set<string>([...staff.filter((s) => isParticipantRole(s.adminRole)).map((s) => s.id), ...byStaff.keys()])
  const allInProgress = [...ipIds]
    .map((id) => inProgressCounts(id, nameOf.get(id) ?? '—', mineOf(id), month))
    .filter((r) => r.staffId === viewer.id || anyInProgress(r) || isParticipantRole(staff.find((s) => s.id === r.staffId)?.adminRole))
    .sort((a, b) => a.name.localeCompare(b.name))
  const allStatus = [...ipIds]
    .map((id) => statusCounts(id, nameOf.get(id) ?? '—', mineOf(id), month))
    .filter((r) => r.staffId === viewer.id || anyStatus(r) || isParticipantRole(staff.find((s) => s.id === r.staffId)?.adminRole))
    .sort((a, b) => a.name.localeCompare(b.name))

  const n = daysInMonth(month)
  const lineFor = (id: string): ChartLine => {
    const t = targets.get(id)
    return { staffId: id, name: nameOf.get(id) ?? '—', values: cumulativeByDay(mineOf(id), month, nowMs), target: t ? targetLine(t, month, countingStarts) : null }
  }

  const board: TargetBoard = {
    month,
    months: pickerMonths(nowMs),
    tense,
    scope,
    countingStarts,
    countingFrom: countingFromLabel(month, countingStarts),
    team: null,
    teamStatus: teamPace.status,
    teamReached: teamPace.reached,
    cards: [],
    noTarget: [],
    ownPaid: null,
    inProgress: [],
    statusCounts: [],
    chart: null,
    setPanel: null,
    myLink: links.find((l) => l.staffId === viewer.id) ?? null,
  }

  if (scope === 'everyone') {
    const keep = (id: string) => !onlyStaff || id === onlyStaff
    board.team = onlyStaff ? null : teamPace
    board.cards = allCards.filter((c) => keep(c.staffId))
    board.noTarget = noTarget.filter((r) => keep(r.staffId))
    board.inProgress = allInProgress.filter((r) => keep(r.staffId))
    board.statusCounts = allStatus.filter((r) => keep(r.staffId))
    board.chart = {
      days: n,
      team: onlyStaff ? null : cumulativeByDay(teamAccounts, month, nowMs),
      teamTarget: onlyStaff || teamTarget <= 0 ? null : targetLine(teamTarget, month, countingStarts),
      people: listIds.filter(keep).map(lineFor),
    }
  } else if (scope === 'target_self') {
    board.team = null
    board.cards = allCards.filter((c) => c.staffId === viewer.id)
    board.inProgress = allInProgress.filter((r) => r.staffId === viewer.id)
    board.statusCounts = allStatus.filter((r) => r.staffId === viewer.id)
    board.chart = { days: n, team: null, teamTarget: null, people: [lineFor(viewer.id)] }
  } else {
    board.teamStatus = null
    board.teamReached = false
    const paid = paidInMonth(mineOf(viewer.id), month)
    board.ownPaid = { paid: paid.length, ...split(paid) }
    board.inProgress = allInProgress.filter((r) => r.staffId === viewer.id)
    board.statusCounts = allStatus.filter((r) => r.staffId === viewer.id)
  }

  if (viewer.adminRole === 'owner') {
    const ids = new Set<string>([...staff.filter((s) => isParticipantRole(s.adminRole) && !s.suspended).map((s) => s.id), ...list])
    board.setPanel = [...ids]
      .filter((id) => nameOf.has(id))
      .map((id) => ({ staffId: id, name: nameOf.get(id)!, onList: list.has(id), target: targets.get(id) ?? null, lastMonth: lastTargets.get(id) ?? null }))
      .sort((a, b) => Number(b.onList) - Number(a.onList) || a.name.localeCompare(b.name))
  }
  return board
}

/** May this viewer read the board for `staffId`? (the API's ?staff=) */
export function mayViewTargetStaff(viewer: Viewer, staffId: string): boolean {
  return mayViewStaff(viewer, staffId)
}

// ------------------------------------------------------------ writes (Owner)

type Actor = { id: string; adminRole: AdminRole; email: string | null }

export async function saveTargets(
  actor: Actor,
  month: MonthKey,
  entries: { staffId: string; target: number | null }[],
  /** 'YYYY-MM-DD' inside the month (checked by the route), or null = leave as it is. */
  countingStarts: string | null = null,
): Promise<{ ok: true; changed: number } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const [staff, before, startBefore] = await Promise.all([loadStaff(), loadTargets(month), loadCountingStart(month)])
  const known = new Set(staff.map((s) => s.id))
  const changes: { staffId: string; before: number | null; after: number }[] = []
  for (const e of entries) {
    if (e.target == null) continue // empty box: leave as it is
    if (!known.has(e.staffId)) return { ok: false, status: 400, error: 'One of those people is not a staff member.' }
    const prev = before.get(e.staffId) ?? null
    if (prev === e.target) continue
    changes.push({ staffId: e.staffId, before: prev, after: e.target })
  }
  const startAfter = countingStarts == null ? null : countingStartDate(month, countingStarts)
  const startChange = startAfter && startAfter !== startBefore ? { before: startBefore, after: startAfter } : null
  if (changes.length === 0 && !startChange) return { ok: true, changed: 0 }
  const now = new Date().toISOString()
  if (changes.length > 0) {
    const { error } = await admin
      .from('staff_monthly_targets')
      .upsert(
        changes.map((c) => ({ staff_id: c.staffId, month, target: c.after, set_by: actor.id, updated_at: now })),
        { onConflict: 'staff_id,month' },
      )
    if (error) return { ok: false, status: 500, error: 'The targets did not save. Please try again.' }
  }
  if (startChange) {
    const { error } = await admin
      .from('staff_target_months')
      .upsert({ month, counting_starts: startChange.after, set_by: actor.id, updated_at: now }, { onConflict: 'month' })
    if (error) return { ok: false, status: 500, error: 'The counting start date did not save. Please try again.' }
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.targets_set',
    targetType: 'staff_targets',
    targetId: month,
    detail: startChange ? { month, changes, countingStarts: startChange } : { month, changes },
  })
  return { ok: true, changed: changes.length + (startChange ? 1 : 0) }
}

export async function setOnTargetList(
  actor: Actor,
  staffId: string,
  onList: boolean,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: p } = await admin.from('profiles').select('role').eq('id', staffId).maybeSingle()
  if (!p || p.role !== 'admin') return { ok: false, status: 404, error: 'That staff member was not found.' }
  const { data: prev } = await admin.from('staff_target_list').select('on_list').eq('staff_id', staffId).maybeSingle()
  const before = !!prev?.on_list
  if (before === onList) return { ok: true }
  const { error } = await admin
    .from('staff_target_list')
    .upsert({ staff_id: staffId, on_list: onList, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.target_list',
    targetType: 'profile',
    targetId: staffId,
    detail: { onList, before },
  })
  return { ok: true }
}
