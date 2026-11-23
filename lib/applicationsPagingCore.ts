// lib/applicationsPagingCore.ts
//
// PURE. Tuitions → Applications, worked out on the SERVER (owner, 28 Oct 2026:
// "Admin lists load 25 items at a time with 'Load more', with counts and
// filters computed on the server. Search still covers everything.").
//
// The page loads the whole board once, and this function decides — over the
// WHOLE board — the tab counts, the stage chip counts, the Staff dropdown, the
// search hits and the groups (by tuition, or by tutor), then pages the groups
// 25 at a time (lib/adminPagingCore). The collapsed "Older" section pages its
// own groups with its own address parameter. Only what is shown is sent to the
// browser, with the few extra rows a shown group needs for its count line (the
// tuition's every application) or its tutor message (the tutor's every
// application).
//
// The rules are the v3 rules unchanged: dueState / sectionOf / groupRows
// (lib/applicationFollowUpCore), matchesStaff / staffChoices / searchMatches
// (lib/applicationStageCore). The search covers To do, Sent and Older, with the
// Staff and stage filters set aside, and each result says which tab it is in.
//
// PR-19 (owner, 23 Nov 2026):
//   * Date chips (Today · Yesterday · Last 7 days · This month · All, ?date=):
//     the application's applied time in the lib/countsCore windows (Pakistan
//     time). The chosen window narrows EVERYTHING here — the tab counts, the
//     stage chips, the Staff dropdown, the search and the groups. Inside a
//     window the newest applications come first (groups by their newest row).
//   * Older is a tab of its own ("Older N", ?tab=older) instead of a collapsed
//     section under To do.

import { pageSlice, type PageSlice } from '@/lib/adminPagingCore'
import { countSpan, inSpan, type CountPeriod } from '@/lib/countsCore'
import {
  dueState,
  groupRows,
  sectionOf,
  tabCounts,
  type DueState,
  type FollowUpRecord,
  type Group,
  type Section,
} from '@/lib/applicationFollowUpCore'
import {
  matchesStaff,
  searchMatches,
  staffChoices,
  STAGES,
  type ActorLike,
  type BoardItem,
  type Stage,
  type StaffChoice,
  type StaffFilter,
} from '@/lib/applicationStageCore'

export type AppsView = 'tuition' | 'tutor'
export type AppsTab = 'todo' | 'sent' | 'older'

/** The date chip: one lib/countsCore window, or every application. */
export type AppsDate = CountPeriod | 'all'
export const APPS_DATES: { key: AppsDate; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All' },
]

export function parseAppsDate(v: string | null | undefined): AppsDate {
  return APPS_DATES.some((d) => d.key === v) ? (v as AppsDate) : 'all'
}

export function parseAppsTab(v: string | null | undefined): AppsTab {
  return v === 'sent' || v === 'older' ? v : 'todo'
}

/** Made in the chosen window (Pakistan time, lib/countsCore) — 'all' keeps every row. */
export function inAppsDate(createdAt: string | null | undefined, date: AppsDate, nowMs: number): boolean {
  return date === 'all' || inSpan(createdAt, countSpan(date, nowMs))
}

const at = (v: string | null | undefined) => {
  const n = v ? Date.parse(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** Inside a date chip: newest application first, groups by their newest row. */
export function newestFirst<T extends { id: string; createdAt: string }>(groups: Group<T>[]): Group<T>[] {
  const order = (a: T, b: T) => at(b.createdAt) - at(a.createdAt) || a.id.localeCompare(b.id)
  return groups
    .map((g) => ({ ...g, rows: [...g.rows].sort(order) }))
    .sort((a, b) => at(b.rows[0]?.createdAt) - at(a.rows[0]?.createdAt) || a.key.localeCompare(b.key))
}

/** The fields this needs from a board row (BoardRow in lib/applicationTracking). */
export type AppsRowLike = BoardItem & {
  id: string
  jobId: string
  tutorId: string
  tutorName: string
  jobRef: string | null
  /** JOB-TX-… (PR-07: searchable). */
  jobTx?: string | null
  jobTitle: string
  jobCity: string | null
  followUps: FollowUpRecord[]
}

export type WithDue<R> = R & { due: DueState; section: Section }

/** A card from the forward board — only what deciding the "viewed only" list needs. */
export type ForwardCardLike = { jobId: string; state: { tab: string } }

export type AppsViewInput<R extends AppsRowLike, C extends ForwardCardLike> = {
  rows: R[]
  nowMs: number
  staffFilter: StaffFilter
  stageFilter: Stage | 'any'
  tab: AppsTab
  view: AppsView
  q: string
  /** The date chip (?date=); 'all' when absent. */
  date?: AppsDate
  /** Groups shown (?n=). */
  shown: number
  /** "Viewed the number" tuitions shown (?vn=). */
  viewedShown: number
  forwardCards: C[]
  names: Map<string, string>
  actor: ActorLike
}

export type AppsViewResult<R extends AppsRowLike, C extends ForwardCardLike> = {
  /** To do / Sent / Older counts, within the date chip and the Staff filter. */
  counts: Record<Section, number>
  /** Stage chip counts, within the date chip, the Staff filter and the tab. */
  stageCounts: Record<string, number>
  choices: StaffChoice[]
  searching: boolean
  /** Every search hit on the whole board. */
  hitCount: number
  /** The groups shown, and how many there are in all. */
  groups: PageSlice<Group<WithDue<R>>>
  /** Every application on the board (the "All" date chip). */
  boardTotal: number
  /** Applications on the board in the date chip, every staff member and tab. */
  dateRowCount: number
  viewedOnly: PageSlice<C>
  /** Every application of each shown group's tuition / tutor (count line, tutor message). */
  related: Record<string, WithDue<R>[]>
  /** The search hits among the shown rows (highlighted). */
  hitIds: string[]
  /** The forward cards the shown groups and "viewed only" rows can open. */
  cards: C[]
}

export function withDue<R extends AppsRowLike>(rows: R[], nowMs: number): WithDue<R>[] {
  return rows.map((r) => {
    const due = dueState(r, r.followUps, nowMs)
    return { ...r, due, section: sectionOf(due) }
  })
}

export function applicationsView<R extends AppsRowLike, C extends ForwardCardLike>(input: AppsViewInput<R, C>): AppsViewResult<R, C> {
  const { nowMs, staffFilter, stageFilter, tab, view, q } = input
  const date = input.date ?? 'all'
  const everyRow = withDue(input.rows, nowMs)
  // The date chip narrows everything below — counts, chips, Staff, search.
  const all = date === 'all' ? everyRow : everyRow.filter((r) => inAppsDate(r.createdAt, date, nowMs))
  const choices = staffChoices(all, input.names, input.actor)
  const byStaff = all.filter((r) => matchesStaff(r, staffFilter))
  const counts = tabCounts(byStaff)
  const filtered = byStaff.filter((r) => stageFilter === 'any' || r.stage === stageFilter)
  const stageCounts: Record<string, number> = { any: 0 }
  for (const s of STAGES) stageCounts[s] = 0
  for (const r of byStaff.filter((r) => r.section === tab)) {
    stageCounts.any++
    stageCounts[r.stage]++
  }

  // The search covers EVERY row in the date chip — To do, Sent and Older,
  // every staff member and stage.
  const searching = q.trim().length > 0
  const hits = new Set(searching ? all.filter((r) => searchMatches(r, q)).map((r) => r.id) : [])
  const keyOf = (r: WithDue<R>) => (view === 'tutor' ? r.tutorId : r.jobId)
  const listed = searching ? all.filter((r) => hits.has(r.id)) : filtered.filter((r) => r.section === tab)
  const grouped = groupRows(listed, keyOf, searching || tab === 'older' ? 'todo' : tab)
  const groups = pageSlice(date === 'all' ? grouped : newestFirst(grouped), input.shown)

  // Tuitions a paid tutor only VIEWED the number of (no application): they
  // have no row, so the forward panel is reached from this short list.
  const jobsWithRows = new Set(input.rows.map((r) => r.jobId))
  // Not applications, so not in a date chip or the Older tab.
  const viewedAll =
    searching || view !== 'tuition' || date !== 'all' || tab === 'older'
      ? []
      : input.forwardCards.filter((c) => !jobsWithRows.has(c.jobId) && (tab === 'todo' ? c.state.tab === 'to_forward' : c.state.tab !== 'to_forward'))
  const viewedOnly = pageSlice(viewedAll, input.viewedShown)

  const shownGroups = groups.rows
  const shownKeys = new Set(shownGroups.map((g) => g.key))
  const related: Record<string, WithDue<R>[]> = {}
  for (const r of everyRow) {
    const k = keyOf(r)
    if (shownKeys.has(k)) (related[k] ??= []).push(r)
  }
  const hitIds = shownGroups.flatMap((g) => g.rows.filter((r) => hits.has(r.id)).map((r) => r.id))
  const jobIds = new Set<string>([...shownGroups.flatMap((g) => g.rows.map((r) => r.jobId)), ...viewedOnly.rows.map((c) => c.jobId)])
  const cards = input.forwardCards.filter((c) => jobIds.has(c.jobId))

  return {
    counts,
    stageCounts,
    choices,
    searching,
    hitCount: hits.size,
    groups,
    boardTotal: everyRow.length,
    dateRowCount: all.length,
    viewedOnly,
    related,
    hitIds,
    cards,
  }
}
