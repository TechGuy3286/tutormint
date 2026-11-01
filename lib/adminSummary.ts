import 'server-only'

// lib/adminSummary.ts — the pre-calculated admin summary and lists (owner,
// 1 Nov 2026; rules in lib/adminSummaryCore). rebuildAdminSummary() runs the
// SAME loaders the pages used to run on every load, once, and stores:
//   admin_summary   'badges', 'overview:7', 'overview:30', 'sections', 'people', 'fu', 'state'
//   admin_list_rows People (tutors, parents) and Follow-ups (tutor scopes, parents)
// The pages read them (readSummary, listPage). Run by /api/cron/admin-summary
// every minute when something changed, at least every 10 minutes, and by the
// Overview's Refresh button.

import { createAdminClient } from '@/lib/supabase/admin'
import { withRunMemo } from '@/lib/runMemo'
import {
  addRunToTally,
  needsRebuild,
  updatedLabel,
  PARENT_FU_LIST,
  peopleList,
  searchHaystack,
  tally,
  tutorFuList,
  tutorTabSection,
  emptyListPage,
  type BadgesPayload,
  type JobStats,
  type ListPage,
  type SummaryState,
} from '@/lib/adminSummaryCore'
import { loadOverviewList } from '@/lib/overviewItems'
import { OVERVIEW_ITEMS, type OverviewItemKey } from '@/lib/overviewItemsCore'
import { duplicateTags, inTab, loadDirectory, loadDirectoryDocs, type DirectoryPerson, type StaffPerson } from '@/lib/peopleDirectory'
import { openTags } from '@/lib/memberDuplicates'
import { DUP_WORDS, EXCLUDE_WORDS, PARENT_VERIFICATION_WORDS, paidTag, postedTag, waitingBadge, type DupLink } from '@/lib/peopleDirectoryCore'
import type { CardDocs } from '@/lib/tutorDocSummaries'
import { loadTutorFollowUps, type TutorFollowRow } from '@/lib/tutorFollowUps'
import { loadParentFollowUps } from '@/lib/parentFollowUps'
import { chipRank } from '@/lib/tutorFollowUpCore'
import { fuBadgeCount } from '@/lib/tutorFollowUpTabsCore'
import { TUTOR_SCOPES } from '@/lib/staffOutreachCore'
import { overdueApplicationsItems } from '@/lib/applicationTracking'
import { loadPaidTutors } from '@/lib/paidTutors'
import { receiptsWaitingCount } from '@/lib/payments/receipt'
import { loadTeamOverview } from '@/lib/teamOverview'
import { loadSignupFunnel } from '@/lib/siteVisits'
import { loadAiAssistantTotals, loadSignupSources } from '@/lib/signupSources'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// ------------------------------------------------------------------ types ---

/** One Overview item as stored: its count (the length of its list), and the
 *  card / extra / note the Overview shows. */
export type OverviewSummaryItem = {
  count: number
  amount?: number
  card?: unknown
  extra?: string | null
  note?: unknown
  filter: string
}
export type OverviewPayload = Partial<Record<OverviewItemKey, OverviewSummaryItem>>

export type PeopleCardRow = {
  name: string
  badge: string | null
  searchText: string
  /** The Parents tab's card block (already in words). */
  parent: {
    mobileVerified: boolean
    tuitionsOpen: number
    tuitionsTotal: number
    plan: string
    verification: string
    verificationTone: 'good' | 'pending' | 'bad' | 'neutral'
    lastActive: string | null
  } | null
  parentWaiting: boolean
  docs: CardDocs | null
  /** Duplicate tags over real accounts only, and over every account ("Show staff & test accounts"). */
  dupes: { id: string; name: string; reason: string; reasonKey: string }[]
  dupesAll: { id: string; name: string; reason: string; reasonKey: string }[]
  tags: Record<string, string>
}

export type PeoplePayload = {
  counts: { tutors: number; parents: number; staff: number }
  hidden: { tutor: number; parent: number }
  videosWaiting: number
  parentsWaiting: number
  staff: StaffPerson[]
}

export type FuPayload = { parentNotInterested: number }

export type SectionsPayload = {
  team: Awaited<ReturnType<typeof loadTeamOverview>> | null
  funnel: Awaited<ReturnType<typeof loadSignupFunnel>> | null
  sources: Awaited<ReturnType<typeof loadSignupSources>> | null
  ai: Awaited<ReturnType<typeof loadAiAssistantTotals>> | null
}

// ------------------------------------------------------------------- read ---

export type SummaryRead = Map<string, { payload: unknown; computedAt: string }>

/** One read for every summary key a page needs. Empty on any failure. */
export async function readSummary(keys: string[]): Promise<SummaryRead> {
  const out: SummaryRead = new Map()
  const admin = createAdminClient()
  if (!admin) return out
  const { data } = await admin.from('admin_summary').select('key, payload, computed_at').in('key', keys)
  for (const r of data ?? []) out.set(r.key as string, { payload: r.payload, computedAt: r.computed_at as string })
  return out
}

export type ListQuery = {
  fixed?: Record<string, unknown>
  since?: string | null
  until?: string | null
  q?: string
  rows?: { param: string; value: string }[]
  split?: string | null
  splitValues?: string[] | null
  order?: 'pos' | 'sort_asc' | 'overdue_rank' | 'overdue' | 'overdue_sort'
  offset?: number
  limit?: number
}

/** A page of a pre-calculated list, counted in SQL (admin_list_page). */
export async function listPage<R>(list: string, qry: ListQuery): Promise<ListPage<R>> {
  const admin = createAdminClient()
  if (!admin) return emptyListPage<R>()
  const needle = (qry.q ?? '').trim().toLowerCase()
  const digits = needle.replace(/\D/g, '')
  const { data, error } = await admin.rpc('admin_list_page', {
    p_list: list,
    p_fixed: qry.fixed ?? {},
    p_since: qry.since ?? null,
    p_until: qry.until ?? null,
    p_needle: needle,
    p_digits: digits,
    p_rows: qry.rows ?? [],
    p_split: qry.split ?? null,
    p_split_values: qry.splitValues ?? null,
    p_order: qry.order ?? 'pos',
    p_offset: qry.offset ?? 0,
    p_limit: qry.limit ?? 25,
  })
  if (error || !data) return emptyListPage<R>()
  return data as ListPage<R>
}

// ------------------------------------------------------------------ write ---

async function readState(admin: Admin): Promise<SummaryState> {
  const { data } = await admin.from('admin_summary').select('key, payload, computed_at').in('key', ['state', 'dirty'])
  const state = data?.find((r) => r.key === 'state')
  const dirty = data?.find((r) => r.key === 'dirty')
  const p = (state?.payload ?? {}) as { builtAt?: string | null; startedAt?: string | null }
  return { builtAt: p.builtAt ?? null, startedAt: p.startedAt ?? null, dirtyAt: (dirty?.computed_at as string | undefined) ?? null }
}

async function put(admin: Admin, key: string, payload: unknown, at: string) {
  const { error } = await admin.from('admin_summary').upsert({ key, payload, computed_at: at })
  if (error) throw new Error(`summary ${key}: ${error.message}`)
}

type ListRowIn = { member_id: string; pos: number; search: string; digits?: string; tags: Record<string, unknown>; sort_at?: string | null; row: unknown }

/** Replace one list: write every row stamped with this run, then remove the
 *  rows this run did not write. Readers never see an empty list mid-way. */
async function replaceList(admin: Admin, list: string, rows: ListRowIn[], at: string) {
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400).map((r) => ({
      list,
      member_id: r.member_id,
      pos: r.pos,
      search: r.search,
      digits: r.digits ?? '',
      tags: r.tags,
      sort_at: r.sort_at ?? null,
      row: r.row,
      computed_at: at,
    }))
    const { error } = await admin.from('admin_list_rows').upsert(part, { onConflict: 'list,member_id' })
    if (error) throw new Error(`list ${list}: ${error.message}`)
  }
  const { error } = await admin.from('admin_list_rows').delete().eq('list', list).lt('computed_at', at)
  if (error) throw new Error(`list ${list}: ${error.message}`)
}

const TONE: Record<string, PeopleCardRow['parent'] extends infer P ? (P extends { verificationTone: infer T } ? T : never) : never> = {
  approved: 'good',
  waiting: 'pending',
  rejected: 'bad',
  none: 'neutral',
}

function dupeWords(links: DupLink[] | undefined) {
  return (links ?? []).map((l) => ({ id: l.id, name: l.name, reason: DUP_WORDS[l.reason], reasonKey: l.reason }))
}

function peopleRows(list: DirectoryPerson[], docs: Map<string, CardDocs>, dupes: Map<string, DupLink[]>, dupesAll: Map<string, DupLink[]>, role: 'tutor' | 'parent'): ListRowIn[] {
  return list.map((p, pos) => {
    const badge = p.banned ? 'Banned' : p.suspended ? 'Paused' : p.excluded ? EXCLUDE_WORDS[p.excluded] : null
    const d = role === 'tutor' ? (docs.get(p.id) ?? null) : null
    const tags: Record<string, string> =
      role === 'tutor' ? { paid: paidTag(p.feePaidAt) } : { posted: postedTag(p.parent?.tuitionsTotal ?? 0), pv: p.parent?.verification ?? 'none' }
    const row: PeopleCardRow = {
      name: p.name,
      badge,
      searchText: p.searchText,
      parent: p.parent
        ? {
            mobileVerified: p.parent.mobileVerified,
            tuitionsOpen: p.parent.tuitionsOpen,
            tuitionsTotal: p.parent.tuitionsTotal,
            plan: p.parent.plan,
            verification: PARENT_VERIFICATION_WORDS[p.parent.verification],
            verificationTone: TONE[p.parent.verification] ?? 'neutral',
            lastActive: p.parent.lastActive,
          }
        : null,
      parentWaiting: p.parent?.verification === 'waiting',
      docs: d,
      dupes: dupeWords(dupes.get(p.id)),
      dupesAll: dupeWords(dupesAll.get(p.id)),
      tags,
    }
    return {
      member_id: p.id,
      pos,
      search: searchHaystack([p.name, p.city, badge, p.searchText]),
      digits: p.searchText,
      tags: { ...tags, ...(d ? { docs: d.kind } : {}), excluded: p.excluded !== null },
      sort_at: d?.oldestUploadAt ?? null,
      row,
    }
  })
}

function tutorFuRows(rows: TutorFollowRow[]): ListRowIn[] {
  return rows.map((r, pos) => ({
    member_id: r.id,
    pos,
    search: searchHaystack([r.name, r.city]),
    tags: {
      chips: r.chips,
      rank: chipRank(r.primary),
      overdue: r.state.overdue,
      tabsec: tutorTabSection(r.state),
      joined_at: r.joinedAt,
      feePaid: r.feePaid,
    },
    sort_at: r.state.dueAt,
    row: r,
  }))
}

/**
 * Work everything out and store it. Skips (ran: false) when nothing changed
 * and the last build is under 10 minutes old, or another rebuild is running;
 * `force` ignores the first (the Refresh button). Each part that fails is
 * reported and leaves the previous figures in place.
 */
export async function rebuildAdminSummary(opts: { force?: boolean } = {}): Promise<{ ran: boolean; ms: number; cpuMs?: number; failed: string[] }> {
  // One run shares its heavy loads (lib/runMemo — push 3, owner 1 Nov 2026).
  return withRunMemo(() => rebuildOnce(opts))
}

async function rebuildOnce(opts: { force?: boolean }): Promise<{ ran: boolean; ms: number; cpuMs?: number; failed: string[] }> {
  const t0 = Date.now()
  const admin = createAdminClient()
  if (!admin) return { ran: false, ms: 0, failed: ['no database'] }
  const state = await readState(admin)
  if (!needsRebuild(state, t0, opts.force)) return { ran: false, ms: Date.now() - t0, failed: [] }
  const at = new Date(t0).toISOString()
  const c0 = process.cpuUsage()
  await put(admin, 'state', { builtAt: state.builtAt, startedAt: at }, at)

  const failed: string[] = []
  const safe = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      failed.push(`${name}: ${e instanceof Error ? e.message : 'failed'}`)
      return null
    }
  }

  const keys = Object.keys(OVERVIEW_ITEMS) as OverviewItemKey[]
  const funnelKeys = keys.filter((k) => OVERVIEW_ITEMS[k].funnel)
  const toItem = (l: Awaited<ReturnType<typeof loadOverviewList>>): OverviewSummaryItem => ({
    count: l.rows.length,
    amount: l.amount,
    card: l.card ?? null,
    extra: l.extra ?? null,
    note: l.note ?? null,
    filter: l.filter,
  })

  const [ov7, ov30, sections, dir, docs, tutorScopes, openFu, parentFu, apps, paid, reports, receipts] = await Promise.all([
    safe('overview', async () => {
      const out: OverviewPayload = {}
      await Promise.all(keys.map(async (k) => (out[k] = toItem(await loadOverviewList(k, { days: 7 })))))
      return out
    }),
    safe('overview 30 days', async () => {
      const out: OverviewPayload = {}
      await Promise.all(funnelKeys.map(async (k) => (out[k] = toItem(await loadOverviewList(k, { days: 30 })))))
      return out
    }),
    safe('sections', async () => {
      const [team, funnel, sources, ai] = await Promise.all([
        loadTeamOverview().catch(() => null),
        loadSignupFunnel().catch(() => null),
        loadSignupSources().catch(() => null),
        loadAiAssistantTotals().catch(() => null),
      ])
      return { team, funnel, sources, ai } satisfies SectionsPayload
    }),
    safe('people', () => loadDirectory()),
    safe('documents', () => loadDirectoryDocs()),
    safe('follow-ups', async () => Promise.all(TUTOR_SCOPES.map(async (s) => [s, await loadTutorFollowUps(s)] as const))),
    safe('follow-ups badge', () => loadTutorFollowUps('open')),
    safe('parent follow-ups', () => loadParentFollowUps()),
    safe('applications', () => overdueApplicationsItems()),
    safe('paid tutors', () => loadPaidTutors()),
    safe('reports', async () => (await admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')).count ?? 0),
    safe('receipts', () => receiptsWaitingCount()),
  ])

  // Overview, sections.
  if (ov7) await safe('write overview', () => put(admin, 'overview:7', ov7, at))
  if (ov7 && ov30) await safe('write overview 30', () => put(admin, 'overview:30', { ...ov7, ...ov30 }, at))
  if (sections) await safe('write sections', () => put(admin, 'sections', sections, at))

  // People.
  if (dir && docs) {
    const tutors = inTab(dir.people, 'tutor', true)
    const parents = inTab(dir.people, 'parent', true)
    const real = dir.people.filter((p) => p.excluded === null)
    const [dupes, dupesAll] = await Promise.all([
      safe('duplicates', async () => openTags(await duplicateTags(real))),
      safe('duplicates (all)', async () => openTags(await duplicateTags(dir.people))),
    ])
    const people: PeoplePayload = {
      counts: { tutors: tutors.filter((p) => p.excluded === null).length, parents: parents.filter((p) => p.excluded === null).length, staff: dir.staff.length },
      hidden: { tutor: tutors.filter((p) => p.excluded !== null).length, parent: parents.filter((p) => p.excluded !== null).length },
      videosWaiting: tutors.filter((p) => p.excluded === null && p.videoWaiting).length,
      parentsWaiting: parents.filter((p) => p.excluded === null && p.parent?.verification === 'waiting').length,
      staff: dir.staff,
    }
    await safe('write people', () => put(admin, 'people', people, at))
    await safe('write tutors', () => replaceList(admin, peopleList('tutor'), peopleRows(tutors, docs, dupes ?? new Map(), dupesAll ?? new Map(), 'tutor'), at))
    await safe('write parents', () => replaceList(admin, peopleList('parent'), peopleRows(parents, docs, dupes ?? new Map(), dupesAll ?? new Map(), 'parent'), at))
  }

  // Follow-ups.
  if (tutorScopes) for (const [s, rows] of tutorScopes) await safe(`write follow-ups ${s}`, () => replaceList(admin, tutorFuList(s), tutorFuRows(rows), at))
  if (parentFu) {
    const rows: ListRowIn[] = parentFu.rows.map((r, pos) => ({
      member_id: r.id,
      pos,
      search: searchHaystack([r.name, r.city]),
      tags: { pchip: [r.posted ? 'posted' : 'not_posted', r.verification], ni: r.notInterested, overdue: r.state.overdue, tabsec: tutorTabSection(r.state) },
      sort_at: r.joinedAt,
      row: r,
    }))
    await safe('write parent follow-ups', () => replaceList(admin, PARENT_FU_LIST, rows, at))
    await safe('write fu', () => put(admin, 'fu', { parentNotInterested: parentFu.rows.filter((r) => r.notInterested).length }, at))
  }

  // Badges — from what was just loaded; a part that failed keeps the old number.
  const prev = (await readSummary(['badges'])).get('badges')?.payload as BadgesPayload | undefined
  const tutors = dir ? inTab(dir.people, 'tutor', false) : null
  const parents = dir ? inTab(dir.people, 'parent', false) : null
  const badges: BadgesPayload = {
    reports: reports ?? prev?.reports ?? 0,
    receipts: receipts ?? prev?.receipts ?? 0,
    peopleWaiting:
      tutors && parents && docs
        ? waitingBadge(
            tutors.map((t) => docs.get(t.id)?.kind ?? null),
            parents.map((p) => p.parent?.verification ?? 'none'),
          )
        : (prev?.peopleWaiting ?? 0),
    followUpsOverdue: openFu ? fuBadgeCount(openFu.map((r) => r.state)) : (prev?.followUpsOverdue ?? 0),
    parentOverdue: parentFu ? fuBadgeCount(parentFu.rows.filter((r) => !r.notInterested).map((r) => r.state)) : (prev?.parentOverdue ?? 0),
    appsOverdue: apps ? tally(apps) : (prev?.appsOverdue ?? { total: 0, byOwner: {} }),
    paidRed: paid ? tally(paid.rows.filter((r) => r.red.length > 0).map((r) => ({ ownerId: r.ownerId ?? null }))) : (prev?.paidRed ?? { total: 0, byOwner: {} }),
  }
  await safe('write badges', () => put(admin, 'badges', badges, at))

  // CPU of this process while the rebuild ran (push 3 cost check). A Fluid instance may serve
  // other requests at the same time, so this is an upper bound for the job alone.
  const c = process.cpuUsage(c0)
  const cpuMs = Math.round((c.user + c.system) / 1000)
  const wallMs = Date.now() - t0
  await put(admin, 'state', { builtAt: at, startedAt: at, ms: wallMs, cpuMs, failed }, at)
  await safe('job stats', async () => {
    const { data } = await admin.from('admin_summary').select('payload').eq('key', 'jobstats').maybeSingle()
    await put(admin, 'jobstats', addRunToTally(data?.payload as JobStats | null, Date.now(), wallMs, cpuMs), at)
  })
  return { ran: true, ms: wallMs, cpuMs, failed }
}

/** "Updated 3 min ago" for a page, read against the server clock. */
export function summaryUpdatedLabel(builtAt: string | null): string {
  return updatedLabel(builtAt, Date.now())
}
