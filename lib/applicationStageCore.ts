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
  /** The last staff (or parent) activity on it — stage change, WhatsApp tap, forward (migration 193). */
  workedAt?: string | null
  /** When the tuition was posted — over 30 days ago it is in the Older section. */
  jobCreatedAt?: string | null
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
    const f = itemOverdue(i, nowMs)
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
    if (!itemOverdue(i, nowMs)) continue
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

// =========================================================== Applications v2
// (owner, 22 Oct 2026). Its own page, Tuitions → Applications: a Staff filter,
// one group per tuition, worked items sink to the bottom, and applications on
// tuitions posted more than 30 days ago sit in a collapsed "Older" section.

export const APPLICATIONS_PATH = '/admin/applications'

/** Tuitions posted longer ago than this are "Older": never overdue, no badge. */
export const OLDER_AFTER_DAYS = 30

const ms = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : NaN
}

/** The last thing that happened to it: its stage change or a later activity. */
export function lastActivityAt(i: Pick<BoardItem, 'stageChangedAt' | 'workedAt'>): string | null {
  const a = ms(i.stageChangedAt)
  const b = ms(i.workedAt)
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null
  return new Date(Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity)).toISOString()
}

/** Posted more than 30 days ago (a tuition with no date is not Older). */
export function isOlderTuition(jobCreatedAt: string | null | undefined, nowMs: number): boolean {
  const t = ms(jobCreatedAt)
  return Number.isFinite(t) && nowMs - t > OLDER_AFTER_DAYS * DAY_MS
}

/** Overdue, counted from the last activity. An Older tuition is never overdue. */
export function itemOverdue(i: BoardItem, nowMs: number): OverdueFlag | null {
  if (isOlderTuition(i.jobCreatedAt, nowMs)) return null
  return overdueFlag(i.stage, lastActivityAt(i), nowMs)
}

/** Worked = has had an activity and is not overdue again. */
export function isWorked(i: BoardItem, nowMs: number): boolean {
  return Number.isFinite(ms(i.workedAt)) && !itemOverdue(i, nowMs)
}

// ------------------------------------------------------------ Staff filter --

/** 'all', 'unassigned', or one staff member's id ('mine' = the viewer). */
export type StaffFilter = string

export function parseStaffFilter(v: string | null | undefined, actor: ActorLike): StaffFilter {
  const s = (v ?? '').trim()
  if (s === 'all' || s === 'unassigned') return s
  if (s === 'mine') return actor.id
  if (/^[0-9a-f-]{36}$/i.test(s)) return s.toLowerCase()
  return defaultFilter(actor) === 'all' ? 'all' : actor.id
}

export function matchesStaff(i: Pick<BoardItem, 'ownerId'>, f: StaffFilter): boolean {
  if (f === 'all') return true
  if (f === 'unassigned') return i.ownerId === null
  return i.ownerId === f
}

export type StaffChoice = { key: StaffFilter; label: string; count: number }

/**
 * The Staff dropdown: All, each staff member who owns a tuition with
 * applications (the viewer always listed, as "Mine"), then Unassigned — each
 * with its count of applications.
 */
export function staffChoices(items: Pick<BoardItem, 'ownerId'>[], names: Map<string, string>, actor: ActorLike): StaffChoice[] {
  const count = new Map<string, number>()
  let unassigned = 0
  for (const i of items) {
    if (i.ownerId) count.set(i.ownerId, (count.get(i.ownerId) ?? 0) + 1)
    else unassigned++
  }
  if (!count.has(actor.id) && actor.adminRole !== 'owner') count.set(actor.id, 0)
  const people = [...count.entries()]
    .map(([id, n]) => ({ key: id, label: id === actor.id ? `Mine (${names.get(id) ?? 'you'})` : (names.get(id) ?? 'Former staff'), count: n }))
    .sort((a, b) => (a.key === actor.id ? -1 : b.key === actor.id ? 1 : a.label.localeCompare(b.label)))
  return [{ key: 'all', label: 'All staff', count: items.length }, ...people, { key: 'unassigned', label: 'Unassigned', count: unassigned }]
}

/** Stage chip: 'any' or one stage. */
export function parseStageFilter(v: string | null | undefined): Stage | 'any' {
  return isStage(v) ? v : 'any'
}

// --------------------------------------------------------------- addresses --

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * The new address for an old Applications link (Follow-ups → Applications, or
 * Applicants to forward), keeping its filters. The old `show=mine|all|
 * unassigned` becomes `staff=`, `show=<stage>` stays a stage chip, and
 * view=forward / fwd= stay as they are.
 */
export function legacyApplicationsHref(sp: Query): string {
  const q = new URLSearchParams()
  const show = one(sp.show)
  if (show === 'mine' || show === 'all' || show === 'unassigned') q.set('staff', show)
  else if (isStage(show)) q.set('show', show)
  for (const k of ['staff', 'view', 'fwd', 'q']) {
    const v = one(sp[k])
    if (v) q.set(k, v)
  }
  // Applicants to forward's own sub-tabs.
  const tab = one(sp.tab)
  if (tab === 'to_forward' || tab === 'forwarded' || tab === 'outcome') {
    q.set('view', 'forward')
    if (tab !== 'to_forward') q.set('fwd', tab)
  }
  const s = q.toString()
  return s ? `${APPLICATIONS_PATH}?${s}` : APPLICATIONS_PATH
}

// ---------------------------------------------------------------- grouping --

export type GroupState = 'overdue' | 'open' | 'worked'

export type BoardGroup<T> = { jobId: string; rows: T[]; state: GroupState; older: boolean }

const RANK: Record<GroupState, number> = { overdue: 0, open: 1, worked: 2 }

function rowRank(i: BoardItem, nowMs: number): number {
  if (itemOverdue(i, nowMs)) return 0
  return isWorked(i, nowMs) ? 2 : 1
}

/** Inside a group: overdue (oldest activity first), then not yet worked (oldest
 *  first), then worked (most recently worked LAST). */
export function sortGroupRows<T extends BoardItem>(rows: T[], nowMs: number): T[] {
  const key = (i: T, r: number) => (r === 2 ? ms(i.workedAt) : r === 0 ? ms(lastActivityAt(i)) : ms(i.createdAt)) || 0
  return [...rows].sort((a, b) => {
    const ra = rowRank(a, nowMs)
    const rb = rowRank(b, nowMs)
    if (ra !== rb) return ra - rb
    return key(a, ra) - key(b, rb) || a.id.localeCompare(b.id)
  })
}

/**
 * One group per tuition. Groups on tuitions posted more than 30 days ago go to
 * `older`. Order: overdue groups (oldest overdue item first), then groups with
 * an item not yet worked (oldest first), then fully worked groups (most
 * recently worked LAST).
 */
export function groupBoard<T extends BoardItem & { jobId: string }>(rows: T[], nowMs: number): { main: BoardGroup<T>[]; older: BoardGroup<T>[] } {
  const byJob = new Map<string, T[]>()
  for (const r of rows) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r])
  const groups: (BoardGroup<T> & { at: number })[] = []
  for (const [jobId, list] of byJob) {
    const sorted = sortGroupRows(list, nowMs)
    const ranks = sorted.map((r) => rowRank(r, nowMs))
    const state: GroupState = ranks.includes(0) ? 'overdue' : ranks.includes(1) ? 'open' : 'worked'
    const at =
      state === 'worked'
        ? Math.max(...sorted.map((r) => ms(r.workedAt) || 0))
        : Math.min(
            ...sorted
              .filter((_, k) => ranks[k] === RANK[state])
              .map((r) => (state === 'overdue' ? ms(lastActivityAt(r)) : ms(r.createdAt)) || 0),
          )
    groups.push({ jobId, rows: sorted, state, older: isOlderTuition(list[0].jobCreatedAt, nowMs), at })
  }
  groups.sort((a, b) => RANK[a.state] - RANK[b.state] || a.at - b.at || a.jobId.localeCompare(b.jobId))
  const strip = (g: BoardGroup<T> & { at: number }): BoardGroup<T> => ({ jobId: g.jobId, rows: g.rows, state: g.state, older: g.older })
  return { main: groups.filter((g) => !g.older).map(strip), older: groups.filter((g) => g.older).map(strip) }
}

/** "4 applied · 1 forwarded" (+ " · 1 hired" when there is one). */
export function groupCountLine(stages: Stage[]): string {
  const t = tallyStages(stages)
  return `${t.applied} applied · ${t.forwarded} forwarded${t.hired ? ` · ${t.hired} hired` : ''}`
}

/** A title cut at a whole word, with an ellipsis. */
export function shortTitle(title: string, max = 60): string {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const sp = cut.lastIndexOf(' ')
  const head = sp > max / 2 ? cut.slice(0, sp) : t.slice(0, max)
  return `${head.replace(/[\s,|·–-]+$/u, '')}…`
}

/** Search: tutor name, TM number (with or without "TM-"), title, city. */
export function searchMatches(r: { tutorName: string; jobRef: string | null; jobTitle: string; jobCity: string | null }, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return false
  const bare = needle.replace(/^tm-?/, '')
  const ref = (r.jobRef ?? '').toLowerCase()
  if (ref && (ref.includes(needle) || (bare.length > 0 && ref.replace(/^tm-?/, '').includes(bare)))) return true
  return [r.tutorName, r.jobTitle, r.jobCity].some((v) => (v ?? '').toLowerCase().includes(needle))
}

/** "Updated 2 days ago by Aqsa" for a worked row. */
export function workedLine(workedAt: string | null | undefined, by: string | null | undefined, nowMs: number): string | null {
  if (!Number.isFinite(ms(workedAt))) return null
  const t = timeAtStage(workedAt ?? null, nowMs)
  const when = t === 'just now' ? 'just now' : `${t} ago`
  return `Updated ${when}${by ? ` by ${by}` : ''}`
}
