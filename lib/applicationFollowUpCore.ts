// lib/applicationFollowUpCore.ts
//
// PURE, client-safe. Applications v3 (owner, 22 Oct 2026): every application
// is in ONE of two tabs, "To do" (its next follow-up is due) or "Sent"
// (followed up, not due again yet). This replaces v2's "worked items sink to
// the bottom".
//
// When a follow-up is due (counted from the current stage only — a stage
// change resets the timer):
//   Applied                       due now; "Forward overdue" after 1 day.
//                                 After a follow-up, due again 1 day later.
//   Forwarded, Contacted, Demo    due 3 days after the last follow-up or the
//                                 stage change, whichever is later ("Check in").
//   Hired, Not selected,          due once. After that message is sent the
//   No response                   application stays in Sent for good ("Done").
// Tuitions posted more than 30 days ago are the collapsed "Older" section at
// the bottom of To do: never overdue, never in a badge.
//
// A "tutor update" (By tutor view) is recorded on each application it lists
// but is NOT a follow-up: it never moves anything to Sent.

import { DAY_MS, isOlderTuition, type ActorLike, type BoardItem, type OverdueFlag, type Stage } from '@/lib/applicationStageCore'
import { STAGE_RECIPIENT, type MessageKey, type Recipient } from '@/lib/applicationMessagesCore'

export type FollowUpKind = 'follow_up' | 'tutor_update'

export type FollowUpRecord = {
  id: string
  applicationId: string
  stage: Stage
  kind: FollowUpKind
  recipient: Recipient
  messageKey: MessageKey
  staffName: string | null
  at: string
}

export const CLOSED_STAGES: readonly Stage[] = ['hired', 'not_selected', 'no_response']
export const CHECK_STAGES: readonly Stage[] = ['forwarded', 'contacted', 'demo']
export const APPLIED_WINDOW_DAYS = 1
export const CHECK_WINDOW_DAYS = 3

export type Tab = 'todo' | 'sent'

export type DueState = {
  tab: Tab
  /** When the next follow-up is due (null = done for good). */
  dueAt: string | null
  overdue: OverdueFlag | null
  /** The follow-up this tab decision rests on (current stage only). */
  last: FollowUpRecord | null
  done: boolean
  older: boolean
  /** The tuition is no longer available (hidden parent): Sent, done, never due. */
  unavailable?: boolean
}

const t = (v: string | null | undefined) => {
  const n = v ? Date.parse(v) : NaN
  return Number.isFinite(n) ? n : NaN
}
const iso = (ms: number) => new Date(ms).toISOString()

/** The latest follow-up made at the CURRENT stage (since it was set). */
export function lastFollowUp(item: Pick<BoardItem, 'stage' | 'stageChangedAt' | 'createdAt'>, records: FollowUpRecord[]): FollowUpRecord | null {
  const since = t(item.stageChangedAt ?? item.createdAt) || 0
  let best: FollowUpRecord | null = null
  for (const r of records) {
    if (r.kind !== 'follow_up' || r.stage !== item.stage) continue
    if ((t(r.at) || 0) < since) continue
    if (!best || t(r.at) > t(best.at)) best = r
  }
  return best
}

/** The latest tutor update on this application (any stage). */
export function lastTutorUpdate(records: FollowUpRecord[]): FollowUpRecord | null {
  let best: FollowUpRecord | null = null
  for (const r of records) if (r.kind === 'tutor_update' && (!best || t(r.at) > t(best.at))) best = r
  return best
}

/** To do or Sent, when it is due, and whether it is overdue. */
export function dueState(item: BoardItem, records: FollowUpRecord[], nowMs: number): DueState {
  const older = isOlderTuition(item.jobCreatedAt, nowMs)
  const last = lastFollowUp(item, records)
  if (item.unavailable) return { tab: 'sent', dueAt: null, overdue: null, last, done: true, older: false, unavailable: true }
  const stageAt = t(item.stageChangedAt ?? item.createdAt) || nowMs
  let dueAt: number | null
  let overdue: OverdueFlag | null = null
  if (CLOSED_STAGES.includes(item.stage)) {
    if (last) return { tab: 'sent', dueAt: null, overdue: null, last, done: true, older }
    dueAt = stageAt
  } else if (item.stage === 'applied') {
    if (last) {
      dueAt = t(last.at) + APPLIED_WINDOW_DAYS * DAY_MS
      if (nowMs >= dueAt) overdue = 'forward_overdue'
    } else {
      dueAt = stageAt
      if (nowMs - stageAt > APPLIED_WINDOW_DAYS * DAY_MS) overdue = 'forward_overdue'
    }
  } else {
    const base = Math.max(stageAt, last ? t(last.at) : -Infinity)
    dueAt = base + CHECK_WINDOW_DAYS * DAY_MS
    if (nowMs >= dueAt) overdue = 'check_in'
  }
  const tab: Tab = nowMs >= dueAt ? 'todo' : 'sent'
  return { tab, dueAt: iso(dueAt), overdue: older ? null : overdue, last, done: false, older }
}

/** The red sidebar badge: overdue To do items (not Older) — the viewer's own,
 *  every one for the site Owner. */
export function todoBadgeCount(items: (BoardItem & { due: DueState })[], actor: ActorLike): number {
  let n = 0
  for (const i of items) {
    if (i.due.tab !== 'todo' || i.due.older || !i.due.overdue) continue
    if (actor.adminRole === 'owner' || i.ownerId === actor.id) n++
  }
  return n
}

export type Section = 'todo' | 'sent' | 'older'

/** Where a row shows: Older (whatever its tab), else its tab. */
export function sectionOf(due: DueState): Section {
  return due.older ? 'older' : due.tab
}

export const SECTION_LABEL: Record<Section, string> = { todo: 'To do', sent: 'Sent', older: 'Older' }

export function tabCounts(items: { due: DueState }[]): Record<Section, number> {
  const c: Record<Section, number> = { todo: 0, sent: 0, older: 0 }
  for (const i of items) c[sectionOf(i.due)]++
  return c
}

/** Who the stage's message goes to. */
export function recipientFor(stage: Stage): Recipient {
  return STAGE_RECIPIENT[stage]
}

// ------------------------------------------------------------------ groups --

export type Group<T> = { key: string; rows: T[]; overdue: boolean; sortAt: number }

/**
 * Group rows (already filtered to one section) by `keyOf` — the tuition, or
 * the tutor. To do: groups with an overdue row first, oldest due first. Sent:
 * soonest next due first; "done" rows after, most recent last. Inside a group
 * the same order applies to the rows.
 */
export function groupRows<T extends { id: string; due: DueState }>(rows: T[], keyOf: (r: T) => string, section: Section): Group<T>[] {
  const rank = (r: T) => (section === 'sent' ? (r.due.done ? 1 : 0) : r.due.overdue ? 0 : 1)
  const at = (r: T) => (r.due.done ? t(r.due.last?.at) : t(r.due.dueAt)) || 0
  const order = (a: T, b: T) => rank(a) - rank(b) || at(a) - at(b) || a.id.localeCompare(b.id)
  const by = new Map<string, T[]>()
  for (const r of rows) by.set(keyOf(r), [...(by.get(keyOf(r)) ?? []), r])
  const groups = [...by.entries()].map(([key, list]) => {
    const sorted = [...list].sort(order)
    return { key, rows: sorted, overdue: sorted.some((r) => !!r.due.overdue), sortAt: at(sorted[0]), first: sorted[0] }
  })
  groups.sort((a, b) => rank(a.first) - rank(b.first) || a.sortAt - b.sortAt || a.key.localeCompare(b.key))
  return groups.map(({ first: _f, ...g }) => g)
}

/** "Profile shared sent to Parent by Aqsa, 2 days ago · next due 25 Oct". */
export function sentLine(args: { messageLabel: string; recipientLabel: string; staffName: string | null; ago: string; nextDue: string | null }): string {
  const by = args.staffName ? ` by ${args.staffName}` : ''
  return `${args.messageLabel} sent to ${args.recipientLabel}${by}, ${args.ago} · ${args.nextDue ? `next due ${args.nextDue}` : 'Done'}`
}

// ------------------------------------------------- v3.1: Applied = forward --

/**
 * Applications v3.1 (owner, 23 Oct 2026): sending the Applied-stage message to
 * the parent IS forwarding that tutor. The application moves to Forwarded,
 * the forward is recorded on the tuition, and the parent follow-up is
 * recorded at the Forwarded stage — so it goes to Sent, due again 3 days
 * later under the Forwarded rule. All three carry ONE time stamp.
 *
 * Undo (10 seconds in the browser, sender only) reverses all of it — only
 * while nothing else has touched the application since.
 */
export const APPLIED_FORWARD_MESSAGE: MessageKey = 'share_profile'
/** The server's grace for the 10-second Undo (network and clock slack). */
export const FORWARD_UNDO_MS = 60_000
export const UNDO_CHANGED = "Can't undo, the application has changed since"

export type ForwardUndoFacts = {
  actorId: string
  nowMs: number
  followUp: { staffId: string | null; at: string; undoneAt: string | null }
  app: { stage: string; stageChangedAt: string | null; workedAt: string | null; withdrawnAt: string | null } | null
  /** Other follow-ups (not undone) on this application made at or after it. */
  laterFollowUps: number
}

export type ForwardUndoProblem = 'not_yours' | 'already_undone' | 'too_late' | 'changed'

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && Date.parse(a) === Date.parse(b)

/** null = the Undo may go ahead. */
export function forwardUndoProblem(f: ForwardUndoFacts): ForwardUndoProblem | null {
  if (f.followUp.staffId !== f.actorId) return 'not_yours'
  if (f.followUp.undoneAt) return 'already_undone'
  if (f.nowMs - Date.parse(f.followUp.at) > FORWARD_UNDO_MS) return 'too_late'
  const a = f.app
  if (!a || a.withdrawnAt || a.stage !== 'forwarded') return 'changed'
  if (!same(a.stageChangedAt, f.followUp.at) || !same(a.workedAt, f.followUp.at)) return 'changed'
  if (f.laterFollowUps > 0) return 'changed'
  return null
}

export const FORWARD_UNDO_TEXT: Record<ForwardUndoProblem, string> = {
  not_yours: 'Only the person who sent it can undo it.',
  already_undone: 'That was already undone.',
  too_late: "Can't undo, it is too late now.",
  changed: UNDO_CHANGED,
}
