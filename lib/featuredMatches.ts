// lib/featuredMatches.ts — tutor Featured, "Matched tuitions on your WhatsApp"
// (owner, 21 Nov 2026 — PR-14), the I/O half. Rules: lib/featuredMatchesCore.
//
//   generateFeaturedItems  once a Pakistan day (5-minute cron, from 08:00 PKT):
//                          one featured_match_items row per active, eligible
//                          tutor Featured plan holder with at least one match.
//   loadFeaturedQueue      today's items for People → WhatsApp updates → Today.
//   recordFeaturedSend /   Send (logs staff and time, hands back the WhatsApp
//   undoFeaturedSend       address) and Undo (sender or Owner, same day).
//
// Service role; the page and the route check SCREEN_ACCESS.waUpdates first.
// The tutor's number never reaches the page — only the WhatsApp address, at
// Send. Never logs a phone, a message or a name. Never touches
// whatsapp_update_sends, so the WhatsApp updates caps are not affected.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { tuitionPath } from '@/lib/slugs'
import { absoluteUrl } from '@/lib/siteUrl'
import { waSendHref } from '@/lib/waLinkCore'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { cityMap, siteOwnerId } from '@/lib/cityOwners'
import { cityOwnerFor } from '@/lib/cityOwnersCore'
import { matchVisibilityCities, isOnlineType } from '@/lib/matchChip'
import { genderApplyBlocked } from '@/lib/genderPref'
import { firstNameOf } from '@/lib/staffOutreachCore'
import { isHiddenTuition } from '@/lib/hiddenTuitionCore'
import { loadTeaserTutors, type TeaserTutor } from '@/lib/tutorTeasers'
import { mayUndoWaSend } from '@/lib/tutorTeasersCore'
import {
  FEATURED_DAY_SETTING,
  FEATURED_MATCH_WINDOW_MS,
  FEATURED_PLAN_CODE,
  featuredItemState,
  featuredItemsDue,
  featuredMatchMessage,
  pickFeaturedMatches,
  pkDay,
  type AreasByCity,
  type FeaturedItemState,
  type FeaturedJob,
  type MatchRules,
} from '@/lib/featuredMatchesCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type R = Record<string, unknown>

const RULES: MatchRules = {
  visibility: (jobType, jobCity, tutorTypes, tutorCities) => matchVisibilityCities(jobType, jobCity, tutorTypes, tutorCities),
  genderBlocked: (pref, g) => genderApplyBlocked(pref, g),
}

/** Active tutor Featured plan holders (ids). */
async function featuredTutorIds(admin: Admin, nowMs: number): Promise<string[]> {
  const rows = await pageAll<R>((f, t) =>
    admin
      .from('subscriptions')
      .select('id, user_id')
      .eq('status', 'active')
      .eq('plan_code', FEATURED_PLAN_CODE)
      .gt('expires_at', new Date(nowMs).toISOString())
      .order('id')
      .range(f, t),
  )
  return [...new Set(rows.map((r) => r.user_id as string).filter(Boolean))]
}

/** Who gets an item: eligible like every WhatsApp update (not test, staff,
 *  paused, suspended, banned, erase-requested, Not interested…), except that a
 *  just-paid tutor is not held back (they bought this), opted in, with a number. */
function deliverable(t: TeaserTutor): boolean {
  return (t.block === null || t.block === 'too_soon') && t.whatsappUpdates && !!normalisePkMobile(t.rawNumber)
}

async function loadJobs(admin: Admin, ids: string[] | null, sinceIso: string | null): Promise<FeaturedJob[]> {
  const cols = 'id, title, city, area, teaching_mode, gender_preference, created_at, status, under_review, merged_into, public_slug, job_tx_id'
  const rows = ids
    ? await pageAllIn<R, string>(ids, (part, f, t) => admin.from('jobs').select(cols).in('id', part).order('id').range(f, t), 100, READ_CONCURRENCY)
    : await pageAll<R>((f, t) => admin.from('jobs').select(cols).eq('status', 'open').gte('created_at', sinceIso as string).order('id').range(f, t))
  const live = rows.filter((j) => j.status === 'open' && !isHiddenTuition(j.status as string) && !j.under_review && !j.merged_into)
  const links = await pageAllIn<R, string>(live.map((j) => j.id as string), (part, f, t) => admin.from('job_subjects').select('job_id, master_id').in('job_id', part).order('job_id').order('master_id').range(f, t), 100, READ_CONCURRENCY)
  const subs = new Map<string, number[]>()
  for (const l of links) subs.set(l.job_id as string, [...(subs.get(l.job_id as string) ?? []), Number(l.master_id)])
  return live.map((j) => ({
    id: j.id as string,
    masterIds: subs.get(j.id as string) ?? [],
    city: (j.city as string | null) ?? null,
    jobType: (j.teaching_mode as string | null) ?? null,
    genderPreference: (j.gender_preference as string | null) ?? null,
    createdAt: j.created_at as string,
    title: ((j.title as string | null) ?? '').trim() || 'Tuition',
    area: (j.area as string | null) ?? null,
    url: absoluteUrl(tuitionPath({ public_slug: j.public_slug as string | null, city: j.city as string | null, job_tx_id: j.job_tx_id as string | null, id: j.id as string })),
  }))
}

async function areasFor(admin: Admin, tutorIds: string[]): Promise<Map<string, AreasByCity>> {
  const rows = await pageAllIn<R, string>(tutorIds, (part, f, t) => admin.from('tutor_areas').select('id, tutor_id, city, area').in('tutor_id', part).order('id').range(f, t), 100, READ_CONCURRENCY)
  const out = new Map<string, Map<string, string[]>>()
  for (const r of rows) {
    const city = ((r.city as string | null) ?? '').trim().toLowerCase()
    const area = ((r.area as string | null) ?? '').trim()
    if (!city || !area) continue
    const m = out.get(r.tutor_id as string) ?? new Map<string, string[]>()
    m.set(city, [...(m.get(city) ?? []), area])
    out.set(r.tutor_id as string, m)
  }
  return out
}

/** Tuitions already sent to each tutor in an earlier item (never sent twice). */
async function alreadySent(admin: Admin, tutorIds: string[]): Promise<Map<string, Set<string>>> {
  const rows = await pageAllIn<R, string>(tutorIds, (part, f, t) =>
    admin.from('featured_match_items').select('id, tutor_id, job_ids, sent_at, undone_at').in('tutor_id', part).not('sent_at', 'is', null).is('undone_at', null).order('id').range(f, t),
    100,
    READ_CONCURRENCY,
  )
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    const s = out.get(r.tutor_id as string) ?? new Set<string>()
    for (const j of (r.job_ids as string[] | null) ?? []) s.add(j)
    out.set(r.tutor_id as string, s)
  }
  return out
}

export type FeaturedGenerateResult = { day: string; ran: boolean; featured: number; created: number; skippedNone: number; notDeliverable: number }

/** Make today's items (once a Pakistan day, from 08:00 PKT). `dryRun` writes
 *  nothing and reports what it would make (scripts/report-featured-matches.ts). `force` runs
 *  regardless of the stored day (tests / a manual rerun — the unique index
 *  still keeps one item per tutor per day). */
export async function generateFeaturedItems(nowMs = Date.now(), opts: { force?: boolean; dryRun?: boolean } = {}): Promise<FeaturedGenerateResult> {
  const day = pkDay(nowMs)
  const empty: FeaturedGenerateResult = { day, ran: false, featured: 0, created: 0, skippedNone: 0, notDeliverable: 0 }
  const admin = createAdminClient()
  if (!admin) return empty
  if (!opts.force && !opts.dryRun) {
    const { data } = await admin.from('app_settings').select('value').eq('key', FEATURED_DAY_SETTING).maybeSingle()
    if (!featuredItemsDue(nowMs, (data?.value as string | null) ?? null)) return empty
  }
  const ids = await featuredTutorIds(admin, nowMs)
  const tutors = ids.length ? await loadTeaserTutors(admin, nowMs, ids) : []
  const ok = tutors.filter(deliverable)
  const out: FeaturedGenerateResult = { day, ran: true, featured: ids.length, created: 0, skippedNone: 0, notDeliverable: ids.length - ok.length }
  if (ok.length) {
    const [jobs, areas, sent, owners, ownerId] = await Promise.all([
      loadJobs(admin, null, new Date(nowMs - FEATURED_MATCH_WINDOW_MS).toISOString()),
      areasFor(admin, ok.map((t) => t.id)),
      alreadySent(admin, ok.map((t) => t.id)),
      cityMap(admin),
      siteOwnerId(admin),
    ])
    const rows: R[] = []
    for (const t of ok) {
      const picks = pickFeaturedMatches({ jobs, tutor: t.match, areas: areas.get(t.id) ?? new Map(), alreadySent: sent.get(t.id) ?? new Set(), nowMs, rules: RULES, isOnline: isOnlineType })
      if (picks.length === 0) {
        out.skippedNone++
        continue
      }
      rows.push({ tutor_id: t.id, pk_day: day, job_ids: picks.map((j) => j.id), assignee_id: ownerId ? cityOwnerFor(t.match.cities[0] ?? null, owners, ownerId) : null })
    }
    if (opts.dryRun) out.created = rows.length
    else if (rows.length) {
      const { data, error } = await admin.from('featured_match_items').upsert(rows, { onConflict: 'tutor_id,pk_day', ignoreDuplicates: true }).select('id')
      if (error) throw new Error('featured items: insert failed')
      out.created = (data ?? []).length
    }
  }
  if (!opts.dryRun) await admin.from('app_settings').upsert({ key: FEATURED_DAY_SETTING, value: day }, { onConflict: 'key' })
  return out
}

// ------------------------------------------------------------------ queue ---

export type FeaturedQueueRow = {
  itemId: string
  tutorId: string
  name: string
  city: string | null
  assigneeId: string | null
  assigneeName: string
  state: FeaturedItemState
  tuitions: { title: string; area: string | null; city: string | null; url: string }[]
  message: string
  sent: { at: string; by: string | null; staffId: string | null } | null
}

type Built = FeaturedQueueRow & { msisdn: string | null }

async function buildRows(admin: Admin, nowMs: number, itemId?: string): Promise<Built[]> {
  const day = pkDay(nowMs)
  let q = admin.from('featured_match_items').select('id, tutor_id, pk_day, job_ids, assignee_id, sent_at, sent_by, sent_by_name, undone_at').eq('pk_day', day)
  if (itemId) q = q.eq('id', itemId)
  const { data: items } = await q.order('created_at')
  if (!items?.length) return []
  const tutorIds = [...new Set(items.map((i) => i.tutor_id as string))]
  const [tutors, featured, jobs, support] = await Promise.all([
    loadTeaserTutors(admin, nowMs, tutorIds),
    featuredTutorIds(admin, nowMs),
    loadJobs(admin, [...new Set(items.flatMap((i) => (i.job_ids as string[]) ?? []))], null),
    loadSupportWhatsApp(admin),
  ])
  const tBy = new Map(tutors.map((t) => [t.id, t]))
  const still = new Set(featured)
  const jBy = new Map(jobs.map((j) => [j.id, j]))
  const staffIds = [...new Set(items.map((i) => i.assignee_id as string | null).filter((x): x is string => !!x))]
  const { data: staff } = staffIds.length ? await admin.from('profiles').select('id, full_name').in('id', staffIds) : { data: [] as R[] }
  const staffName = new Map((staff ?? []).map((s) => [s.id as string, formatName((s.full_name as string | null) ?? null) || 'Staff']))
  const out: Built[] = []
  for (const i of items) {
    const t = tBy.get(i.tutor_id as string)
    const state = featuredItemState({ sentAt: (i.sent_at as string | null) ?? null, undoneAt: (i.undone_at as string | null) ?? null })
    // An unsent item drops a tutor who is no longer Featured or eligible, and
    // tuitions that closed since; a sent one stays for "Sent by …" and Undo.
    const open = ((i.job_ids as string[]) ?? []).map((id) => jBy.get(id)).filter((j): j is FeaturedJob => !!j)
    if (state === 'to_send' && (!t || !still.has(t.id) || !deliverable(t) || open.length === 0)) continue
    const tuitions = open.map((j) => ({ title: j.title, area: j.area, city: j.city, url: j.url }))
    out.push({
      itemId: i.id as string,
      tutorId: i.tutor_id as string,
      name: formatName(t?.fullName ?? null) || 'Tutor',
      city: t?.match.cities[0] ?? null,
      assigneeId: (i.assignee_id as string | null) ?? null,
      assigneeName: i.assignee_id ? (staffName.get(i.assignee_id as string) ?? 'Staff') : 'Owner',
      state,
      tuitions,
      message: state === 'to_send' ? featuredMatchMessage({ firstName: firstNameOf(t?.fullName ?? null), tuitions, supportWhatsapp: support }) : '',
      sent: state === 'sent' ? { at: i.sent_at as string, by: (i.sent_by_name as string | null) ?? null, staffId: (i.sent_by as string | null) ?? null } : null,
      msisdn: t ? normalisePkMobile(t.rawNumber) : null,
    })
  }
  return out
}

/** Today's Featured items: to send first, then sent. */
export async function loadFeaturedQueue(nowMs = Date.now()): Promise<FeaturedQueueRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = await buildRows(admin, nowMs)
  return rows
    .map(({ msisdn: _m, ...r }) => r)
    .sort((a, b) => (a.state !== b.state ? (a.state === 'to_send' ? -1 : 1) : a.name.localeCompare(b.name)))
}

/** Rows still to send today (for the sidebar badge). Null on failure. */
export async function featuredToSendCount(nowMs = Date.now()): Promise<number | null> {
  try {
    return (await loadFeaturedQueue(nowMs)).filter((r) => r.state === 'to_send').length
  } catch {
    return null
  }
}

export type FeaturedSendResult = { ok: true; waHref: string } | { ok: false; status: number; error: string }

export async function recordFeaturedSend(itemId: string, actor: AdminActor): Promise<FeaturedSendResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const nowMs = Date.now()
  const [row] = await buildRows(admin, nowMs, itemId)
  if (!row) return { ok: false, status: 409, error: 'This item is not in today’s list any more.' }
  if (row.state === 'sent') return { ok: false, status: 409, error: 'This item was already sent today.' }
  if (!row.msisdn) return { ok: false, status: 409, error: 'This tutor has no WhatsApp number on file.' }
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const nowIso = new Date(nowMs).toISOString()
  // Two staff pressing Send at once: only the update that still finds the item
  // unsent (never sent, or undone) wins.
  const { data, error } = await admin
    .from('featured_match_items')
    .update({ sent_at: nowIso, sent_by: actor.id, sent_by_name: formatName((me?.full_name as string | null) ?? null) || null, undone_at: null, undone_by: null })
    .eq('id', itemId)
    .or('sent_at.is.null,undone_at.not.is.null')
    .select('id')
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  if (!data?.length) return { ok: false, status: 409, error: 'Another staff member has just sent this item.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'whatsapp_update.featured_send',
    targetType: 'user',
    targetId: row.tutorId,
    detail: { item_id: itemId, tuitions: row.tuitions.length },
  })
  return { ok: true, waHref: waSendHref(row.msisdn, row.message) }
}

export async function undoFeaturedSend(itemId: string, actor: AdminActor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: i } = await admin.from('featured_match_items').select('id, tutor_id, sent_at, sent_by, undone_at').eq('id', itemId).maybeSingle()
  if (!i || !i.sent_at) return { ok: false, status: 404, error: 'That send was not found.' }
  const why = mayUndoWaSend({ createdAt: i.sent_at as string, undoneAt: (i.undone_at as string | null) ?? null, staffId: (i.sent_by as string | null) ?? null }, actor, Date.now())
  if (why) return { ok: false, status: 409, error: why }
  const { error } = await admin.from('featured_match_items').update({ undone_at: new Date().toISOString(), undone_by: actor.id }).eq('id', itemId).is('undone_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'whatsapp_update.featured_undo',
    targetType: 'user',
    targetId: i.tutor_id as string,
    detail: { item_id: itemId },
  })
  return { ok: true }
}
