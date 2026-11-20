// lib/parentInterest.ts — the I/O half of the parent-interest teasers (owner,
// 18 Nov 2026 — PR-08). Rules in lib/parentInterestCore. Service role.
//
//   recordParentInterest()   a parent shortlisted a tutor, or tried to message
//                            them or ask for a demo — called by the routes after
//                            the action (or its refusal). One event row; then
//                            the burst check for that parent.
//   runInterestBackfill()    once, from the 5-minute cron: the last 30 days of
//                            shortlists, parent-started conversations and demo
//                            requests become events (source 'backfill'); the
//                            burst check runs over them. The alerts go out over
//                            the next days through the daily teaser run, a few
//                            dozen tutors a day (BACKFILL_TUTORS_PER_DAY).
//   loadInterestForTutors()  the usable (not alerted, not held, real-parent)
//                            events per tutor, with the parents' blurred-name
//                            facts — for the daily run and the WhatsApp queue.
//   loadHeldActivity() / decideHeldActivity()  the Owner's "Held activity" panel.
//
// Nothing here logs or returns a phone or email; the cron and report results
// are counts only. The parent account is never suspended or changed.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { getViewAsContext } from '@/lib/viewAsContext'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import type { AdminActor } from '@/lib/adminAuth'
import { DAY_MS } from '@/lib/tutorTeasersCore'
import {
  BACKFILL_DAYS,
  burstOf,
  BURST_WINDOW_MS,
  decideHold,
  EVENT_USABLE_DAYS,
  holdAfterBurst,
  isHeld,
  parentCounts,
  usableEvents,
  type BlockedWhy,
  type Hold,
  type HoldStatus,
  type InterestEvent,
  type InterestKind,
} from '@/lib/parentInterestCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type R = Record<string, unknown>

const BACKFILL_DONE_KEY = 'interest.backfill_done_at'

// ------------------------------------------------------------------ record ---

/**
 * Store one real parent action on a tutor. Only a PARENT account acting on a
 * TUTOR account is stored; anything else (a tutor, staff, View as) is ignored.
 * Staff/test parents ARE stored but never used (parentCounts at read time), so
 * the burst check still sees them. Never throws; never blocks the action.
 */
export async function recordParentInterest(p: { parentId: string; tutorId: string; kind: InterestKind; blocked?: BlockedWhy | null; sourceRef?: string | null }): Promise<void> {
  try {
    if (!p.parentId || !p.tutorId || p.parentId === p.tutorId) return
    if (await getViewAsContext().catch(() => null)) return
    const admin = createAdminClient()
    if (!admin) return
    const { data: ps } = await admin.from('profiles').select('id, role').in('id', [p.parentId, p.tutorId])
    const role = new Map((ps ?? []).map((r) => [r.id as string, r.role as string | null]))
    if (role.get(p.parentId) !== 'parent' || role.get(p.tutorId) !== 'tutor') return
    const { error } = await admin.from('parent_interest_events').insert({
      tutor_id: p.tutorId,
      parent_id: p.parentId,
      kind: p.kind,
      blocked: p.blocked ?? null,
      source: 'live',
      source_ref: p.sourceRef ?? null,
    })
    if (error) return
    await checkBurst(admin, p.parentId, Date.now())
  } catch {
    /* the action itself stands */
  }
}

/** The burst check for one parent over the last hour. */
async function checkBurst(admin: Admin, parentId: string, nowMs: number): Promise<void> {
  const since = new Date(nowMs - BURST_WINDOW_MS).toISOString()
  const { data } = await admin.from('parent_interest_events').select('kind, created_at').eq('parent_id', parentId).gte('created_at', since).limit(500)
  const burst = burstOf((data ?? []).map((e) => ({ kind: e.kind as InterestKind, createdAt: e.created_at as string })))
  if (!burst) return
  const { data: cur } = await admin.from('interest_holds').select('status, decided_at').eq('parent_id', parentId).maybeSingle()
  const hold: Hold | null = cur ? { status: cur.status as HoldStatus, decidedAt: (cur.decided_at as string | null) ?? null } : null
  await applyHold(admin, parentId, hold, burst)
}

async function applyHold(admin: Admin, parentId: string, hold: Hold | null, burst: ReturnType<typeof burstOf>): Promise<boolean> {
  const step = holdAfterBurst(hold, burst)
  if (!step || !burst) return false
  const row = { status: 'held', detected_at: new Date().toISOString(), window_start: burst.windowStart, shortlists: burst.shortlists, attempts: burst.attempts }
  if (step === 'create') {
    const { error } = await admin.from('interest_holds').upsert({ parent_id: parentId, ...row }, { onConflict: 'parent_id', ignoreDuplicates: true })
    return !error
  }
  const { error } = await admin.from('interest_holds').update({ ...row, decided_by: null, decided_at: null }).eq('parent_id', parentId).eq('status', 'released')
  return !error
}

// ----------------------------------------------------------------- backfill ---

export type BackfillResult = { ran: boolean; inserted: Record<InterestKind, number>; holdsCreated: number; errors: string[] }

/**
 * The one-time backfill: the last 30 days of real parent actions become events.
 * Idempotent (source_ref per source row; a source row is never stored twice),
 * and marked done in app_settings so the 5-minute cron runs it once. `force`
 * runs it even when marked done (still adds nothing twice).
 */
export async function runInterestBackfill(opts: { nowMs?: number; dryRun?: boolean; force?: boolean } = {}): Promise<BackfillResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const out: BackfillResult = { ran: false, inserted: { shortlist: 0, message: 0, demo: 0 }, holdsCreated: 0, errors: [] }
  const admin = createAdminClient()
  if (!admin) return { ...out, errors: ['service-role client unavailable'] }
  try {
    if (!opts.force) {
      const { data } = await admin.from('app_settings').select('value').eq('key', BACKFILL_DONE_KEY).maybeSingle()
      if (data?.value) return out
    }
    out.ran = true
    const since = new Date(nowMs - BACKFILL_DAYS * DAY_MS).toISOString()
    const [acts, threads, demos] = await Promise.all([
      pageAll<R>((f, t) =>
        admin.from('user_activity_log').select('id, user_id, target_id, created_at').eq('event', 'shortlist_added').gte('created_at', since).order('id').range(f, t) as never,
      ),
      pageAll<R>((f, t) =>
        admin.from('threads').select('id, participant_a, participant_b, initiated_by, created_at').gte('created_at', since).order('id').range(f, t) as never,
      ),
      pageAll<R>((f, t) => admin.from('demo_requests').select('id, parent_id, tutor_id, created_at').gte('created_at', since).order('id').range(f, t) as never),
    ])

    type Cand = { ref: string; parentId: string; tutorId: string; kind: InterestKind; at: string }
    const cands: Cand[] = []
    for (const a of acts) {
      const tid = String(a.target_id ?? '')
      if (/^[0-9a-f-]{36}$/i.test(tid)) cands.push({ ref: `act:${a.id}`, parentId: a.user_id as string, tutorId: tid, kind: 'shortlist', at: a.created_at as string })
    }
    for (const th of threads) {
      const by = th.initiated_by as string | null
      if (!by) continue
      const other = by === th.participant_a ? (th.participant_b as string) : (th.participant_a as string)
      cands.push({ ref: `thread:${th.id}`, parentId: by, tutorId: other, kind: 'message', at: th.created_at as string })
    }
    for (const d of demos) cands.push({ ref: `demo:${d.id}`, parentId: d.parent_id as string, tutorId: d.tutor_id as string, kind: 'demo', at: d.created_at as string })

    // Only a parent acting on a tutor.
    const ids = [...new Set(cands.flatMap((c) => [c.parentId, c.tutorId]))]
    const [profs, tps] = await Promise.all([
      pageAllIn(ids, (part, f, t) => admin.from('profiles').select('id, role').in('id', part).order('id').range(f, t)),
      pageAllIn(ids, (part, f, t) => admin.from('tutor_profiles').select('id, verified_fee_paid_at').in('id', part).order('id').range(f, t)),
    ])
    const role = new Map(profs.map((p) => [p.id as string, p.role as string | null]))
    const paidAt = new Map(tps.map((t) => [t.id as string, (t.verified_fee_paid_at as string | null) ?? null]))
    const real = cands.filter((c) => c.parentId !== c.tutorId && role.get(c.parentId) === 'parent' && role.get(c.tutorId) === 'tutor')

    // Never store a source row twice (a live write may already carry its ref).
    const existing = new Set(
      (
        await pageAllIn(
          real.map((c) => c.ref),
          (part, f, t) => admin.from('parent_interest_events').select('id, source_ref').in('source_ref', part).order('id').range(f, t),
        )
      ).map((e) => e.source_ref as string),
    )
    const fresh = real.filter((c) => !existing.has(c.ref))
    const rows = fresh.map((c) => {
      const paid = paidAt.get(c.tutorId)
      const unpaidThen = c.kind !== 'shortlist' && (!paid || Date.parse(paid) > Date.parse(c.at))
      return { tutor_id: c.tutorId, parent_id: c.parentId, kind: c.kind, blocked: unpaidThen ? 'tutor_unpaid' : null, source: 'backfill', source_ref: c.ref, created_at: c.at }
    })
    for (const r of rows) out.inserted[r.kind]++
    if (!opts.dryRun) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from('parent_interest_events').insert(rows.slice(i, i + 500))
        if (error) throw new Error(`insert: ${error.message}`)
      }
    }

    // The burst check over the backfilled history, per parent.
    const byParent = new Map<string, { kind: InterestKind; createdAt: string }[]>()
    for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), { kind: r.kind, createdAt: r.created_at }])
    const holds = await loadHolds(admin, [...byParent.keys()])
    for (const [pid, ev] of byParent) {
      const burst = burstOf(ev)
      if (!holdAfterBurst(holds.get(pid) ?? null, burst)) continue
      if (opts.dryRun || (await applyHold(admin, pid, holds.get(pid) ?? null, burst))) out.holdsCreated++
    }
    if (!opts.dryRun) await admin.from('app_settings').upsert({ key: BACKFILL_DONE_KEY, value: new Date(nowMs).toISOString() }, { onConflict: 'key' })
  } catch (e) {
    out.errors.push(String((e as Error).message ?? e).slice(0, 200))
  }
  return out
}

// ------------------------------------------------------------------- reads ---

export async function loadHolds(admin: Admin, parentIds?: string[]): Promise<Map<string, Hold>> {
  const rows: R[] = parentIds
    ? await pageAllIn(parentIds, (part, f, t) => admin.from('interest_holds').select('parent_id, status, decided_at').in('parent_id', part).order('parent_id').range(f, t), 100, READ_CONCURRENCY)
    : await pageAll<R>((f, t) => admin.from('interest_holds').select('parent_id, status, decided_at').order('parent_id').range(f, t) as never)
  return new Map(rows.map((h) => [h.parent_id as string, { status: h.status as HoldStatus, decidedAt: (h.decided_at as string | null) ?? null }]))
}

export type ParentInfo = { name: string | null; city: string | null; area: string | null; counts: boolean }

/** The parents' blurred-name facts and whether their activity counts at all. */
export async function loadParentInfo(admin: Admin, ids: string[]): Promise<Map<string, ParentInfo>> {
  if (ids.length === 0) return new Map()
  const [ps, erasures] = await Promise.all([
    pageAllIn(ids, (part, f, t) =>
      admin
        .from('profiles')
        .select('id, role, admin_role, full_name, city, area, is_seed, is_team_account, is_test_name, hidden_from_public, merged_into')
        .in('id', part)
        .order('id')
        .range(f, t),
    100, READ_CONCURRENCY),
    pageAllIn(ids, (part, f, t) => admin.from('account_erasures').select('id, member_id').in('member_id', part).in('status', ['scheduled', 'done']).order('id').range(f, t), 100, READ_CONCURRENCY),
  ])
  const erased = new Set(erasures.map((e) => e.member_id as string))
  return new Map(
    ps.map((p) => [
      p.id as string,
      {
        name: (p.full_name as string | null) ?? null,
        city: (p.city as string | null) ?? null,
        area: (p.area as string | null) ?? null,
        counts: parentCounts({
          role: (p.role as string | null) ?? null,
          staff: !!p.admin_role,
          isSeed: p.is_seed as boolean | null,
          isTeam: p.is_team_account as boolean | null,
          isTestName: p.is_test_name as boolean | null,
          hidden: p.hidden_from_public as boolean | null,
          mergedInto: (p.merged_into as string | null) ?? null,
          erased: erased.has(p.id as string),
        }),
      },
    ]),
  )
}

/**
 * Usable parent-interest events per tutor since `sinceIso` (default the 45-day
 * usable window). `ignoreAlerted` reads events whether or not the in-app alert
 * already carried them (the WhatsApp queue has its own "already sent" record).
 */
export async function loadInterestForTutors(
  admin: Admin,
  nowMs: number,
  opts: { tutorIds?: string[]; sinceIso?: string; ignoreAlerted?: boolean } = {},
): Promise<{ byTutor: Map<string, InterestEvent[]>; parents: Map<string, ParentInfo> }> {
  const since = opts.sinceIso ?? new Date(nowMs - EVENT_USABLE_DAYS * DAY_MS).toISOString()
  const sel = 'id, tutor_id, parent_id, kind, created_at, source, alerted_at'
  const rows: R[] = opts.tutorIds
    ? await pageAllIn(opts.tutorIds, (part, f, t) => {
        let q = admin.from('parent_interest_events').select(sel).in('tutor_id', part).gte('created_at', since)
        if (!opts.ignoreAlerted) q = q.is('alerted_at', null)
        return q.order('id').range(f, t)
      })
    : await pageAll<R>((f, t) => {
        let q = admin.from('parent_interest_events').select(sel).gte('created_at', since)
        if (!opts.ignoreAlerted) q = q.is('alerted_at', null)
        return q.order('id').range(f, t) as never
      })
  const events: InterestEvent[] = rows.map((r) => ({
    id: r.id as string,
    tutorId: r.tutor_id as string,
    parentId: r.parent_id as string,
    kind: r.kind as InterestKind,
    createdAt: r.created_at as string,
    source: (r.source as 'live' | 'backfill') ?? 'live',
    alertedAt: opts.ignoreAlerted ? null : ((r.alerted_at as string | null) ?? null),
  }))
  const parentIds = [...new Set(events.map((e) => e.parentId))]
  const [parents, holds] = await Promise.all([loadParentInfo(admin, parentIds), loadHolds(admin, parentIds)])
  const ok = usableEvents(events, { nowMs, countsParent: (id) => !!parents.get(id)?.counts, held: (id) => isHeld(holds.get(id)) })
  const byTutor = new Map<string, InterestEvent[]>()
  for (const e of ok) byTutor.set(e.tutorId, [...(byTutor.get(e.tutorId) ?? []), e])
  return { byTutor, parents }
}

/** Stamp the events an in-app alert carried. */
export async function markAlerted(admin: Admin, eventIds: string[], atIso: string): Promise<void> {
  for (let i = 0; i < eventIds.length; i += 200) {
    await admin.from('parent_interest_events').update({ alerted_at: atIso }).in('id', eventIds.slice(i, i + 200)).is('alerted_at', null)
  }
}

// ------------------------------------------------- Owner: "Held activity" ---

export type HeldRow = {
  parentId: string
  name: string
  status: HoldStatus
  detectedAt: string
  windowStart: string | null
  shortlists: number
  attempts: number
  heldEvents: number
  decidedAt: string | null
}

/** Every account the burst check held (held and kept first, then released). */
export async function loadHeldActivity(): Promise<HeldRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const holds = await pageAll<R>((f, t) =>
    admin.from('interest_holds').select('parent_id, status, detected_at, window_start, shortlists, attempts, decided_at').order('parent_id').range(f, t) as never,
  )
  if (holds.length === 0) return []
  const ids = holds.map((h) => h.parent_id as string)
  const [ps, ev] = await Promise.all([
    pageAllIn(ids, (part, f, t) => admin.from('profiles').select('id, full_name').in('id', part).order('id').range(f, t)),
    pageAllIn(ids, (part, f, t) => admin.from('parent_interest_events').select('id, parent_id').in('parent_id', part).is('alerted_at', null).order('id').range(f, t)),
  ])
  const name = new Map(ps.map((p) => [p.id as string, formatName((p.full_name as string | null) ?? null) || 'Parent']))
  const count = new Map<string, number>()
  for (const e of ev) count.set(e.parent_id as string, (count.get(e.parent_id as string) ?? 0) + 1)
  const order = (s: string) => (s === 'held' ? 0 : s === 'kept' ? 1 : 2)
  return holds
    .map((h) => ({
      parentId: h.parent_id as string,
      name: name.get(h.parent_id as string) ?? 'Parent',
      status: h.status as HoldStatus,
      detectedAt: h.detected_at as string,
      windowStart: (h.window_start as string | null) ?? null,
      shortlists: Number(h.shortlists) || 0,
      attempts: Number(h.attempts) || 0,
      heldEvents: count.get(h.parent_id as string) ?? 0,
      decidedAt: (h.decided_at as string | null) ?? null,
    }))
    .sort((a, b) => order(a.status) - order(b.status) || b.detectedAt.localeCompare(a.detectedAt))
}

/** The Owner's Release / Keep held. The caller has already refused anyone else. */
export async function decideHeldActivity(parentId: string, decision: 'release' | 'keep', actor: AdminActor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: cur } = await admin.from('interest_holds').select('status, decided_at').eq('parent_id', parentId).maybeSingle()
  const next = decideHold(cur ? { status: cur.status as HoldStatus, decidedAt: (cur.decided_at as string | null) ?? null } : null, decision)
  if ('error' in next) return { ok: false, status: 409, error: next.error }
  const { error } = await admin.from('interest_holds').update({ status: next.status, decided_by: actor.id, decided_at: new Date().toISOString() }).eq('parent_id', parentId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: decision === 'release' ? 'interest_hold.release' : 'interest_hold.keep',
    targetType: 'user',
    targetId: parentId,
    detail: { from: cur?.status ?? null, to: next.status },
  })
  return { ok: true }
}
