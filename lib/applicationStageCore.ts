// lib/applicationStageCore.ts
//
// PURE, client-safe. Application tracking (owner, 22 Oct 2026).
//
// Every application has ONE stage:
//   Applied → Forwarded → Contacted → Demo/interview → Hired
//   or it ends at Not selected / No response.
// Staff change it on Admin → Follow-ups → Applications; the tutor sees it, in
// friendly words, on their own dashboard. A stage NEVER changes the tuition
// (status, expiry, noindex, JobPosting) — that is the parent's own hire.
//
// The rules here are read by the board, the API routes, the sidebar badge,
// the admin tuition card, the public "<n> tutors applied" line, the tutor
// dashboard and the tests — one file, so none of them can disagree.

import { siteLink } from '@/lib/waLinkCore'

export const STAGES = ['applied', 'forwarded', 'contacted', 'demo', 'hired', 'not_selected', 'no_response'] as const
export type Stage = (typeof STAGES)[number]

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v)
}

/** Staff words (the dropdown, the chips, the history). */
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied',
  forwarded: 'Forwarded',
  contacted: 'Contacted',
  demo: 'Demo/interview',
  hired: 'Hired',
  not_selected: 'Not selected',
  no_response: 'No response',
}

/** The tutor's own dashboard words — exactly the owner's wording. */
export const TUTOR_STAGE_TEXT: Record<Stage, string> = {
  applied: 'Sent to the parent team',
  forwarded: 'Shared with the parent',
  contacted: 'Parent contacted you',
  demo: 'Demo/interview stage',
  hired: 'You got this tuition ✓',
  not_selected: 'The parent chose another tutor',
  no_response: 'No reply from the parent',
}

/** Still moving — the stages a Hired application offers to close. */
export const OPEN_STAGES: readonly Stage[] = ['applied', 'forwarded', 'contacted', 'demo']
export const ENDED_STAGES: readonly Stage[] = ['hired', 'not_selected', 'no_response']

export function isOpenStage(s: Stage): boolean {
  return OPEN_STAGES.includes(s)
}

// ------------------------------------------------------------ who may do what

export type ActorLike = { id: string; adminRole: string | null | undefined }

/** The site Owner changes any stage; anyone else only on the tuitions they own
 *  (posted, or were assigned). Everyone else sees it read-only. */
export function mayEditStage(actor: ActorLike | null | undefined, ownerId: string | null): boolean {
  if (!actor) return false
  if (actor.adminRole === 'owner') return true
  return !!ownerId && ownerId === actor.id
}

/** Only the site Owner reassigns a tuition's owner. */
export function mayReassign(actor: ActorLike | null | undefined): boolean {
  return actor?.adminRole === 'owner'
}

// ---------------------------------------------------------------- overdue ----

export const DAY_MS = 24 * 60 * 60 * 1000
export const FORWARD_OVERDUE_DAYS = 1
export const CHECK_IN_DAYS = 3

export type OverdueFlag = 'forward_overdue' | 'check_in'

export const OVERDUE_LABEL: Record<OverdueFlag, string> = {
  forward_overdue: 'Forward overdue',
  check_in: 'Check in',
}

/**
 * "Applied" for MORE than 1 day without being forwarded → red Forward overdue.
 * Forwarded / Contacted / Demo with no update for MORE than 3 days → amber
 * Check in. Exactly 1 day (or exactly 3) is not yet overdue.
 */
export function overdueFlag(stage: Stage, changedAt: string | null, nowMs: number): OverdueFlag | null {
  const at = changedAt ? Date.parse(changedAt) : NaN
  if (!Number.isFinite(at)) return null
  const age = nowMs - at
  if (stage === 'applied') return age > FORWARD_OVERDUE_DAYS * DAY_MS ? 'forward_overdue' : null
  if (stage === 'forwarded' || stage === 'contacted' || stage === 'demo') return age > CHECK_IN_DAYS * DAY_MS ? 'check_in' : null
  return null
}

/** "today", "1 day", "5 days" — how long it has been at this stage. */
export function timeAtStage(changedAt: string | null, nowMs: number): string {
  const at = changedAt ? Date.parse(changedAt) : NaN
  if (!Number.isFinite(at)) return ''
  const days = Math.max(0, Math.floor((nowMs - at) / DAY_MS))
  if (days === 0) {
    const hours = Math.max(0, Math.floor((nowMs - at) / (60 * 60 * 1000)))
    return hours <= 0 ? 'just now' : hours === 1 ? '1 hour' : `${hours} hours`
  }
  return days === 1 ? '1 day' : `${days} days`
}

// ------------------------------------------------------------- the board ----

export type BoardFilter = 'mine' | 'all' | 'unassigned' | Stage

export function defaultFilter(actor: ActorLike | null | undefined): 'mine' | 'all' {
  return actor?.adminRole === 'owner' ? 'all' : 'mine'
}

export function parseFilter(v: string | null | undefined, actor: ActorLike | null | undefined): BoardFilter {
  if (v === 'mine' || v === 'all' || v === 'unassigned' || isStage(v)) return v
  return defaultFilter(actor)
}

export type BoardItem = {
  id: string
  stage: Stage
  stageChangedAt: string | null
  ownerId: string | null
  createdAt: string
}

export function matchesFilter(item: BoardItem, filter: BoardFilter, actorId: string): boolean {
  if (filter === 'all') return true
  if (filter === 'mine') return item.ownerId === actorId
  if (filter === 'unassigned') return item.ownerId === null
  return item.stage === filter
}

/** Overdue first (Forward overdue, then Check in — each oldest first), then
 *  the rest newest stage change first. */
export function sortBoard<T extends BoardItem>(items: T[], nowMs: number): T[] {
  const rank = (i: T) => {
    const f = overdueFlag(i.stage, i.stageChangedAt, nowMs)
    return f === 'forward_overdue' ? 0 : f === 'check_in' ? 1 : 2
  }
  const at = (i: T) => Date.parse(i.stageChangedAt ?? i.createdAt) || 0
  return [...items].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra < 2) return at(a) - at(b) || a.id.localeCompare(b.id)
    return at(b) - at(a) || a.id.localeCompare(b.id)
  })
}

/** Counts behind the chips: Mine, All, Unassigned and one per stage. */
export function boardCounts(items: BoardItem[], actorId: string): Record<BoardFilter, number> {
  const out = { mine: 0, all: 0, unassigned: 0 } as Record<BoardFilter, number>
  for (const s of STAGES) out[s] = 0
  for (const i of items) {
    out.all++
    if (i.ownerId === actorId) out.mine++
    if (i.ownerId === null) out.unassigned++
    out[i.stage]++
  }
  return out
}

/**
 * The Follow-ups red badge: overdue applications on the signed-in staff
 * member's own tuitions — every overdue application for the site Owner.
 */
export function overdueBadgeCount(items: BoardItem[], actor: ActorLike, nowMs: number): number {
  let n = 0
  for (const i of items) {
    if (!overdueFlag(i.stage, i.stageChangedAt, nowMs)) continue
    if (actor.adminRole === 'owner' || i.ownerId === actor.id) n++
  }
  return n
}

/** On Hired: the tuition's OTHER applications still moving, offered to mark
 *  Not selected (the default is to leave them). */
export function otherOpenOnJob<T extends { id: string; jobId: string; stage: Stage }>(all: T[], hired: { id: string; jobId: string }): T[] {
  return all.filter((a) => a.jobId === hired.jobId && a.id !== hired.id && isOpenStage(a.stage))
}

// ---------------------------------------------------- tuition card lines ----

/** Shared with the parent at some point: Forwarded and every stage after it.
 *  Not selected is left out — a tutor can be not selected without ever being
 *  forwarded. */
export const SHARED_STAGES: readonly Stage[] = ['forwarded', 'contacted', 'demo', 'hired', 'no_response']

export type StageTally = { applied: number; forwarded: number; hired: number }

export function tallyStages(stages: Stage[]): StageTally {
  return {
    applied: stages.length,
    forwarded: stages.filter((s) => SHARED_STAGES.includes(s)).length,
    hired: stages.filter((s) => s === 'hired').length,
  }
}

/** Admin tuition card: "6 applied · 2 forwarded · 1 hired" (null when none). */
export function adminStageLine(t: StageTally): string | null {
  if (t.applied <= 0) return null
  return `${t.applied} applied · ${t.forwarded} forwarded · ${t.hired} hired`
}

/** Public cards and pages: a count only — never a name, a stage or "Hired".
 *  Nothing at all below 1. */
export function publicAppliedLine(n: number | null | undefined): string | null {
  const v = Math.floor(Number(n ?? 0))
  if (!Number.isFinite(v) || v < 1) return null
  return v === 1 ? '1 tutor applied' : `${v} tutors applied`
}

// ------------------------------------------------------- WhatsApp check-in ----

function firstName(name: string | null | undefined): string {
  const f = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return f || 'there'
}

/**
 * The English check-in message to the TUTOR, by stage. Never names or
 * numbers the parent. The tuition's page link goes on its own line at the end
 * (lib/waLinkCore puts it there and writes it in full).
 */
export function checkInMessage(args: { stage: Stage; tutorName: string | null; title: string; city: string | null; tuitionPath: string | null }): string {
  const name = firstName(args.tutorName)
  const what = `"${args.title.trim() || 'your tuition'}"${args.city ? ` (${args.city})` : ''}`
  const lead = `Assalam o Alaikum ${name}, this is TutorMint about your application for ${what}.`
  const body: Record<Stage, string> = {
    applied: 'We have it and will share your profile with the parent. We will update you here.',
    forwarded: 'We have shared your profile with the parent. Has the parent contacted you yet?',
    contacted: 'Did you agree a demo lesson or an interview with the parent?',
    demo: 'How did the demo lesson or interview go?',
    hired: 'Congratulations on getting this tuition! How is it going?',
    not_selected: 'The parent chose another tutor this time. New tuitions are posted every day — keep applying.',
    no_response: 'The parent has not replied. New tuitions are posted every day — keep applying.',
  }
  const link = args.stage === 'not_selected' || args.stage === 'no_response' ? siteLink('/browse/tuitions') : args.tuitionPath ? siteLink(args.tuitionPath) : null
  return `${lead} ${body[args.stage]} Reply here if you need help.${link ? `\n\n${link}` : ''}`
}

// --------------------------------------------------------- success story ----

/** Admin → Social posts with the Success story template, "Hired" occasion,
 *  for this tutor. Shown only when the tutor passes the Social posts rule. */
export function successStoryHref(slug: string): string {
  const q = new URLSearchParams({ tutor: slug, template: 'success', success: 'hired' })
  return `/admin/social?${q.toString()}`
}

export const VERIFY_FIRST = 'Verify first'

/** What a row offers for a success story: the Social posts link (Hired AND
 *  the tutor passes the Social posts verified rule), "Verify first" (Hired,
 *  not verified), or nothing (any other stage). */
export function successStoryAction(row: { stage: Stage; tutorVerified: boolean; tutorSlug: string | null }): { href: string } | { label: string } | null {
  if (row.stage !== 'hired') return null
  if (row.tutorVerified && row.tutorSlug) return { href: successStoryHref(row.tutorSlug) }
  return { label: VERIFY_FIRST }
}
