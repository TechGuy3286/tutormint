// lib/pipelineRowUpdateCore.ts
//
// A tutor's People card moves at once (owner, 15 Nov 2026). When a follow-up,
// call outcome, "Not interested", Undo or document decision is logged, the
// request itself rewrites that one tutor's stored People row (admin_list_rows
// 'people:tutor') and nudges the stored badge numbers by the difference —
// so the chip counts (counted live in SQL from the row tags) and the sidebar
// badge are right straight away. The summary job's rebuild stays the safety net
// and recomputes everything from the real tables.
//
// Pure: no I/O. lib/tutorPipeline.ts does the reads and writes.

import { docsReadyForReview, type DocState, type PipeDocs } from '@/lib/tutorPipelineCore'
import { approvedTodayDue, feePendingDue, pipeSortAt, pipeTags, type PipeCard } from '@/lib/tutorPipelineCardCore'
import type { BadgesPayload } from '@/lib/adminSummaryCore'

export type StoredPeopleRow = { tags: Record<string, unknown>; row: Record<string, unknown> & { pipe?: PipeCard } }
export type PeopleRowWrite = { tags: Record<string, unknown>; row: Record<string, unknown>; sort_at: string | null }

/** The new stored row for a changed card: the other tags (city, search, dupes…)
 *  are kept, the pipeline tags and the card are replaced. */
export function peopleRowFor(prev: StoredPeopleRow, next: PipeCard): PeopleRowWrite {
  return {
    tags: { ...prev.tags, ...pipeTags(next) },
    row: { ...prev.row, pipe: next },
    sort_at: pipeSortAt(next),
  }
}

/** The document states read back from a card (CNIC and photo exactly; the
 *  selfie only matters when it is waiting). */
export function docsFromCard(p: PipeCard): PipeDocs {
  const state = (name: string, required: boolean): DocState => {
    if ((p.pending ?? []).includes(name)) return 'waiting'
    if (required && p.missing.includes(name)) return 'none'
    if (required && p.rejected.some((r) => r.name === name)) return 'rejected'
    return required ? 'approved' : 'none'
  }
  return { cnic: state('CNIC', true), photo: state('Profile photo', true), selfie: state('Selfie', false) }
}

/** Counted in the People "documents waiting" badge. */
export function cardReadyForReview(p: PipeCard): boolean {
  return docsReadyForReview(docsFromCard(p), p.completion ?? 0)
}

export type BadgeDelta = { pipelineDue: number; peopleWaiting: number; rejectedUninformed?: number; approvedToday?: number }

/** Counted in the Overview "Rejected, not informed" row (PR-02: the same rule
 *  as its list). */
export function cardRejectedUninformed(p: PipeCard): boolean {
  return p.stage === 'rejected' && !p.notInterested && !p.informed
}

/** How the stored badges change when one card changes. A card that is new or
 *  gone counts as nothing on that side. `real` = the row is a real tutor (not
 *  staff, test or deleted) — only real tutors are in any count (PR-02). */
export function badgeDelta(prev: PipeCard | null, next: PipeCard | null, nowMs: number, real = true): BadgeDelta {
  if (!real) return { pipelineDue: 0, peopleWaiting: 0, rejectedUninformed: 0, approvedToday: 0 }
  const due = (p: PipeCard | null) => (p && feePendingDue(p, nowMs) ? 1 : 0)
  const ready = (p: PipeCard | null) => (p && cardReadyForReview(p) ? 1 : 0)
  const rej = (p: PipeCard | null) => (p && cardRejectedUninformed(p) ? 1 : 0)
  const today = (p: PipeCard | null) => (p && approvedTodayDue(p, nowMs) ? 1 : 0)
  return { pipelineDue: due(next) - due(prev), peopleWaiting: ready(next) - ready(prev), rejectedUninformed: rej(next) - rej(prev), approvedToday: today(next) - today(prev) }
}

/** The stored Overview figures (overview:7 / overview:30) moved by one card's
 *  change, so the to-do rows match the chips at once (PR-02). null when nothing
 *  changes. Never below 0. */
export function applyOverviewDelta<T extends Partial<Record<string, { count: number } | undefined>>>(o: T, d: BadgeDelta): T | null {
  const moves: [string, number][] = [
    ['todo-fee-pending', d.pipelineDue],
    ['todo-docs', d.peopleWaiting],
    ['todo-rejected-uninformed', d.rejectedUninformed ?? 0],
    ['todo-approved-today', d.approvedToday ?? 0],
  ]
  if (moves.every(([, n]) => n === 0)) return null
  const out: Record<string, unknown> = { ...o }
  for (const [k, n] of moves) {
    const cur = o[k]
    if (!cur || n === 0) continue
    out[k] = { ...cur, count: Math.max(0, cur.count + n) }
  }
  return out as T
}

/** The stored badges with a delta applied; never below 0. null when nothing changes. */
export function applyBadgeDelta(b: BadgesPayload, d: BadgeDelta): BadgesPayload | null {
  if (d.pipelineDue === 0 && d.peopleWaiting === 0) return null // (rejectedUninformed is not a badge)
  return {
    ...b,
    pipelineDue: Math.max(0, (b.pipelineDue ?? 0) + d.pipelineDue),
    peopleWaiting: Math.max(0, (b.peopleWaiting ?? 0) + d.peopleWaiting),
  }
}

/** Fields of a live card that the one-card loader cannot work out (the summary
 *  job reads them from wider data) — kept from the stored card. */
export function mergeLiveCard(stored: PipeCard | undefined, live: PipeCard): PipeCard {
  if (!stored) return live
  return {
    ...live,
    lastActiveAt: stored.lastActiveAt ?? live.lastActiveAt,
    blank: stored.blank ?? live.blank,
    paidAt: live.stage === 'paid' ? (stored.paidAt ?? live.paidAt ?? null) : null,
    welcome: live.stage === 'paid' ? (stored.welcome ?? null) : null,
    plan: live.stage === 'paid' ? (stored.plan ?? null) : null,
    niMark: live.notInterested ? (stored.niMark ?? live.niMark ?? null) : null,
  }
}

// --------------------------------------------------------- the page side ---

/** The chips a People → Tutors view applies. `ni` = which Not interested side
 *  the view lists (false = the normal lists, true = the grey chip); undefined
 *  = both (the sign-up-day view). */
export type ChipView = { stage?: string | null; fu?: string | null; ni?: boolean }

function counted(p: PipeCard, view: ChipView): boolean {
  return view.ni === undefined || p.notInterested === view.ni
}

/** Does a card still belong in the view the staff member is looking at? The
 *  optimistic move: after a successful log the card leaves the view at once
 *  when its new state no longer matches. */
export function cardInView(p: PipeCard, view: ChipView): boolean {
  if (!counted(p, view)) return false
  const t = pipeTags(p)
  if (view.stage && view.stage !== 'all' && !t.stages.includes(view.stage)) return false
  if (view.fu && !t.fus.includes(view.fu)) return false
  return true
}

/** How the chip counts move when one card changes: `stage` = the Stage row
 *  (All, each stage, Re-uploaded), `fu` = the Follow-up row of the view's own
 *  stage (it is counted inside that stage). Only non-zero entries. */
export function chipCountShift(prev: PipeCard, next: PipeCard, view: ChipView): { stage: Record<string, number>; fu: Record<string, number> } {
  const stage: Record<string, number> = {}
  const fu: Record<string, number> = {}
  const add = (m: Record<string, number>, k: string, n: number) => {
    m[k] = (m[k] ?? 0) + n
    if (m[k] === 0) delete m[k]
  }
  const side = (p: PipeCard, n: number) => {
    if (!counted(p, view)) return
    const t = pipeTags(p)
    add(stage, 'all', n)
    for (const s of t.stages) add(stage, s, n)
    if (view.stage && t.stages.includes(view.stage)) for (const f of t.fus) add(fu, f, n)
  }
  side(prev, -1)
  side(next, 1)
  return { stage, fu }
}

/** Counts with a shift applied (never below 0). */
export function shiftCounts(counts: Record<string, number>, shift: Record<string, number>): Record<string, number> {
  const out = { ...counts }
  for (const [k, n] of Object.entries(shift)) out[k] = Math.max(0, (out[k] ?? 0) + n)
  return out
}

/** What a route sends back after it moved a card: the card before and after,
 *  so the page can move it out of its chip and shift the counts at once. */
export function movedJson(moved: { prev: PipeCard; next: PipeCard } | null): { moved?: { prev: PipeCard; next: PipeCard } } {
  return moved ? { moved } : {}
}
