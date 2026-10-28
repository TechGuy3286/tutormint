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

import { pageSlice, type PageSlice } from '@/lib/adminPagingCore'
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
export type AppsTab = 'todo' | 'sent'

/** The fields this needs from a board row (BoardRow in lib/applicationTracking). */
export type AppsRowLike = BoardItem & {
  id: string
  jobId: string
  tutorId: string
  tutorName: string
  jobRef: string | null
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
  /** Groups shown (?n=). */
  shown: number
  /** Older groups shown (?on=). */
  olderShown: number
  /** "Viewed the number" tuitions shown (?vn=). */
  viewedShown: number
  forwardCards: C[]
  names: Map<string, string>
  actor: ActorLike
}

export type AppsViewResult<R extends AppsRowLike, C extends ForwardCardLike> = {
  /** To do / Sent / Older counts, within the Staff filter. */
  counts: Record<Section, number>
  /** Stage chip counts, within the Staff filter and the tab. */
  stageCounts: Record<string, number>
  choices: StaffChoice[]
  searching: boolean
  /** Every search hit on the whole board. */
  hitCount: number
  /** The groups shown, and how many there are in all. */
  groups: PageSlice<Group<WithDue<R>>>
  older: PageSlice<Group<WithDue<R>>>
  /** Applications in the Older section (its heading). */
  olderRowCount: number
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
  const all = withDue(input.rows, nowMs)
  const choices = staffChoices(input.rows, input.names, input.actor)
  const byStaff = all.filter((r) => matchesStaff(r, staffFilter))
  const counts = tabCounts(byStaff)
  const filtered = byStaff.filter((r) => stageFilter === 'any' || r.stage === stageFilter)
  const stageCounts: Record<string, number> = { any: 0 }
  for (const s of STAGES) stageCounts[s] = 0
  for (const r of byStaff.filter((r) => r.section === tab)) {
    stageCounts.any++
    stageCounts[r.stage]++
  }

  // The search covers EVERY row — To do, Sent and Older, every staff member
  // and stage — and there is no Older section while searching.
  const searching = q.trim().length > 0
  const hits = new Set(searching ? all.filter((r) => searchMatches(r, q)).map((r) => r.id) : [])
  const keyOf = (r: WithDue<R>) => (view === 'tutor' ? r.tutorId : r.jobId)
  const listed = searching ? all.filter((r) => hits.has(r.id)) : filtered.filter((r) => r.section === tab)
  const groups = pageSlice(groupRows(listed, keyOf, searching ? 'todo' : tab), input.shown)
  const olderRows = searching ? [] : filtered.filter((r) => r.section === 'older')
  const older = pageSlice(tab === 'todo' ? groupRows(olderRows, keyOf, 'todo') : [], input.olderShown)

  // Tuitions a paid tutor only VIEWED the number of (no application): they
  // have no row, so the forward panel is reached from this short list.
  const jobsWithRows = new Set(input.rows.map((r) => r.jobId))
  const viewedAll =
    searching || view !== 'tuition'
      ? []
      : input.forwardCards.filter((c) => !jobsWithRows.has(c.jobId) && (tab === 'todo' ? c.state.tab === 'to_forward' : c.state.tab !== 'to_forward'))
  const viewedOnly = pageSlice(viewedAll, input.viewedShown)

  const shownGroups = [...groups.rows, ...older.rows]
  const shownKeys = new Set(shownGroups.map((g) => g.key))
  const related: Record<string, WithDue<R>[]> = {}
  for (const r of all) {
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
    older,
    olderRowCount: olderRows.length,
    viewedOnly,
    related,
    hitIds,
    cards,
  }
}
