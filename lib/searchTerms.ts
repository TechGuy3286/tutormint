import 'server-only'

// lib/searchTerms.ts — Admin → Growth → Search words, the server half of
// lib/searchTermsCore (owner, 24 Nov 2026 — PR-22 Part D).
//
// Writes: bumpSearchTerm (the search beacon — text and counts per day, no
// identifier), and the screen's actions — "Means the same as…" (a Search word
// in taxonomy_aliases, or an approved area alias in location_area_aliases: the
// tables the ONE smart search and the area filters read, so every search bar
// uses it at once), "Real demand", and Undo. Every action is in the Audit log.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { invalidateMemoTag } from '@/lib/memoCache'
import { logAdminAction } from '@/lib/auditLog'
import { AREA_ALIAS_TAG } from '@/lib/areaAliases'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { loadSearchDictFresh, resolveWith, SMART_SEARCH_TAG } from '@/lib/smartSearch'
import { parseQuery } from '@/lib/smartSearchCore'
import { landingIndexable, liveCombinationsAll, subjectMetaByMaster } from '@/lib/landing'
import { insightsKey, daysBetween, pkDayOf, type InsightsDay } from '@/lib/insightsCore'
import type { AdminActor } from '@/lib/adminAuth'
import {
  DEMAND_WINDOW_DAYS,
  KIND_LABEL,
  MODE_TARGETS,
  cleanTerm,
  mergeTerms,
  suggestPages,
  termKey,
  type AliasKind,
  type DemandCount,
  type DemandKind,
  type Suggestion,
  type TermAction,
  type TermDayRow,
  type TermRow,
} from '@/lib/searchTermsCore'

type R = Record<string, unknown>
const DAY_MS = 86_400_000
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

/** One search's words, counted for today (Pakistan time). Never throws. */
export async function bumpSearchTerm(surface: 'tutors' | 'tuitions', raw: string, o: { zero: boolean; failed: boolean }): Promise<void> {
  try {
    const term = cleanTerm(raw)
    const key = termKey(raw)
    if (!term || !key) return
    const admin = createAdminClient()
    if (!admin) return
    await admin.rpc('bump_search_term', { p_surface: surface, p_key: key, p_term: term, p_zero: o.zero, p_failed: o.failed })
  } catch {
    /* a count is never worth an error */
  }
}

async function termDays(from: string, to: string): Promise<TermDayRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  return (await pageAll<R>((f, t) =>
    admin.from('search_terms').select('day, surface, term_key, term, searches, zero, failed, last_at').gte('day', from).lte('day', to).order('day').order('surface').order('term_key').range(f, t),
  )) as unknown as TermDayRow[]
}

async function loadActions(): Promise<TermAction[]> {
  const admin = createAdminClient()
  if (!admin) return []
  return (await pageAll<R>((f, t) =>
    admin.from('search_term_actions').select('id, term_key, term, action, target_kind, target_slug, target_name, target_city, created_at, undone_at').order('id').range(f, t),
  )) as unknown as TermAction[]
}

export type Target = { kind: AliasKind; slug: string; name: string; city?: string }

/** Everything a word can mean: subjects (schools too), levels, cities, online / home, curated areas. */
export async function loadTargets(): Promise<Target[]> {
  const dict = await loadSearchDictFresh()
  const out: Target[] = []
  for (const s of dict.subjects) out.push({ kind: 'subject', slug: s.slug, name: s.name })
  for (const l of dict.levels) out.push({ kind: 'level', slug: l.slug, name: l.name })
  for (const c of dict.cities) out.push({ kind: 'city', slug: c, name: c })
  for (const m of MODE_TARGETS) out.push({ kind: 'mode', slug: m.slug, name: m.name })
  const admin = createAdminClient()
  if (admin) {
    const areas = await pageAll<R>((f, t) => admin.from('location_areas').select('id, name, location_cities(name)').order('id').range(f, t)).catch(() => [] as R[])
    for (const a of areas) {
      const c = a.location_cities as { name?: string } | { name?: string }[] | null
      const city = (Array.isArray(c) ? c[0] : c)?.name
      if (city && a.name) out.push({ kind: 'area', slug: String(a.id), name: String(a.name), city })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export type SearchWordsScreen = {
  terms: (TermRow & { understood: string | null; actions: TermAction[] })[]
  suggestions: Suggestion[]
  failedTotal: number
}

/** The screen: terms of the period (with what the search already reads them as), actions, suggested pages. */
export async function loadSearchWordsScreen(from: string, to: string, nowMs = Date.now()): Promise<SearchWordsScreen> {
  const [rows, actions, dict] = await Promise.all([termDays(from, to), loadActions(), loadSearchDictFresh()])
  const terms = mergeTerms(rows).map((t) => {
    const r = resolveWith(dict, parseQuery(t.term, dict))
    const understood = r.understood ? r.parsed.spans.map((s) => s.label).join(' · ') || null : null
    return { ...t, understood, actions: actions.filter((a) => a.term_key === t.key && !a.undone_at) }
  })
  return { terms, suggestions: await loadSuggestions(nowMs).catch(() => []), failedTotal: terms.reduce((n, t) => n + t.failed, 0) }
}

/**
 * Suggested pages: city × subject searches of the last 30 days — the counted
 * filter searches (Insights' stored days: city + subject picked) and typed
 * words the smart search reads as a city and a subject — against the landing
 * combinations that are indexable.
 */
export async function loadSuggestions(nowMs = Date.now()): Promise<Suggestion[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const to = pkDayOf(nowMs)
  const from = pkDayOf(nowMs - (DEMAND_WINDOW_DAYS - 1) * DAY_MS)
  const days = daysBetween(from, to)
  const [stored, terms, combos, meta, dict] = await Promise.all([
    pageAllIn<R, string>(days.map(insightsKey), (chunk, f, t) => admin.from('admin_summary').select('key, payload').in('key', chunk).order('key').range(f, t), 100, READ_CONCURRENCY),
    termDays(from, to),
    liveCombinationsAll(),
    subjectMetaByMaster(),
    loadSearchDictFresh(),
  ])
  const demand: DemandCount[] = []
  for (const r of stored) {
    for (const s of ((r.payload as InsightsDay | null)?.searches ?? [])) {
      if (!s.city || s.masterId == null) continue
      const m = meta.get(s.masterId)
      if (m?.subject) demand.push({ city: s.city, subject: m.subject, searches: s.n })
    }
  }
  for (const t of mergeTerms(terms)) {
    const p = parseQuery(t.term, dict)
    if (p.city && p.subject) demand.push({ city: p.city, subject: p.subject.name, searches: t.searches })
  }
  return suggestPages(demand, combos, landingIndexable)
}

export type Wanted = { id: number; key: string; term: string; target: string; searches: number }

/** "Real demand" marks still in force, with the term's searches in the last 30 days — the Overview to-do. */
export async function loadWanted(nowMs = Date.now()): Promise<Wanted[]> {
  const actions = (await loadActions()).filter((a) => a.action === 'demand' && !a.undone_at)
  if (actions.length === 0) return []
  const rows = mergeTerms(await termDays(pkDayOf(nowMs - (DEMAND_WINDOW_DAYS - 1) * DAY_MS), pkDayOf(nowMs)))
  const by = new Map(rows.map((r) => [r.key, r]))
  const seen = new Set<string>()
  const out: Wanted[] = []
  for (const a of actions.sort((x, y) => y.created_at.localeCompare(x.created_at))) {
    if (seen.has(a.term_key)) continue
    seen.add(a.term_key)
    out.push({ id: a.id, key: a.term_key, term: by.get(a.term_key)?.term ?? a.term, target: a.target_name, searches: by.get(a.term_key)?.searches ?? 0 })
  }
  return out.sort((a, b) => b.searches - a.searches || a.term.localeCompare(b.term))
}

// ----------------------------------------------------------------- actions ---

type Result = { ok: true; message: string; id: number } | { ok: false; status: number; error: string }

const auditWho = (actor: AdminActor) => ({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email })

/** "Means the same as…": the term becomes a Search word for the target. */
export async function addMeaning(actor: AdminActor, input: { term: string; kind: AliasKind; slug: string }): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const term = cleanTerm(input.term)
  const key = termKey(input.term)
  if (!term || !key) return { ok: false, status: 400, error: 'A search word is 2 to 80 characters long, with no phone number or email.' }
  const target = (await loadTargets()).find((t) => t.kind === input.kind && t.slug === input.slug)
  if (!target) return { ok: false, status: 400, error: 'Choose what it means from the list.' }

  let aliasTable: string | null = null
  let aliasId: number | null = null
  if (target.kind === 'area') {
    const { data: area } = await admin.from('location_areas').select('id, city_id').eq('id', Number(target.slug)).maybeSingle()
    if (!area) return { ok: false, status: 400, error: 'That area is no longer in the list.' }
    const { data: have } = await admin.from('location_area_aliases').select('id').eq('city_id', area.city_id).ilike('raw', key).is('removed_at', null).maybeSingle()
    if (!have) {
      const { data, error } = await admin
        .from('location_area_aliases')
        .insert({ city_id: area.city_id, raw: term, area_id: area.id, created_by: actor.id, created_by_email: actor.email })
        .select('id')
        .maybeSingle()
      if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
      aliasTable = 'location_area_aliases'
      aliasId = Number(data.id)
    }
  } else {
    const kind = target.kind
    const { data: have } = await admin.from('taxonomy_aliases').select('id').eq('kind', kind).eq('slug', target.slug).eq('alias', key).maybeSingle()
    if (!have) {
      const { data, error } = await admin.from('taxonomy_aliases').insert({ kind, slug: target.slug, alias: key, created_by: actor.id }).select('id').maybeSingle()
      if ((error && error.code !== '23505') || (!data && !error)) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
      if (data) {
        aliasTable = 'taxonomy_aliases'
        aliasId = Number(data.id)
      }
    }
  }
  const { data: row, error } = await admin
    .from('search_term_actions')
    .insert({ term_key: key, term, action: 'alias', target_kind: target.kind, target_slug: target.slug, target_name: target.name, target_city: target.city ?? null, alias_table: aliasTable, alias_id: aliasId, created_by: actor.id })
    .select('id')
    .maybeSingle()
  if (error || !row) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    ...auditWho(actor),
    action: 'search_words.alias',
    targetType: 'search_term',
    targetId: String(row.id),
    detail: { term: key, means: `${KIND_LABEL[target.kind]}: ${target.name}${target.city ? ` (${target.city})` : ''}`, new_word: !!aliasId },
  })
  refreshSearch(target.kind)
  return { ok: true, id: Number(row.id), message: `“${term}” now means ${target.name}${target.city ? ` (${target.city})` : ''} in every search.` }
}

/** "Real demand": the term is a city / subject / level people want that we don't have. */
export async function addDemand(actor: AdminActor, input: { term: string; kind: DemandKind; slug: string }): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const term = cleanTerm(input.term)
  const key = termKey(input.term)
  if (!term || !key) return { ok: false, status: 400, error: 'A search word is 2 to 80 characters long, with no phone number or email.' }
  const target = (await loadTargets()).find((t) => t.kind === input.kind && t.slug === input.slug)
  if (!target) return { ok: false, status: 400, error: 'Choose the city, subject or level people want.' }
  const { data: live } = await admin.from('search_term_actions').select('id').eq('term_key', key).eq('action', 'demand').is('undone_at', null).maybeSingle()
  if (live) return { ok: false, status: 400, error: 'This search is already marked as real demand.' }
  const { data: row, error } = await admin
    .from('search_term_actions')
    .insert({ term_key: key, term, action: 'demand', target_kind: target.kind, target_slug: target.slug, target_name: target.name, created_by: actor.id })
    .select('id')
    .maybeSingle()
  if (error || !row) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({ ...auditWho(actor), action: 'search_words.demand', targetType: 'search_term', targetId: String(row.id), detail: { term: key, wanted: `${KIND_LABEL[target.kind]}: ${target.name}` } })
  return { ok: true, id: Number(row.id), message: `“${term}” is on the Overview to-do as wanted.` }
}

/** Undo either action. A Search word this action added is taken back (an area alias is stamped removed). */
export async function undoTermAction(actor: AdminActor, id: number): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: a } = await admin.from('search_term_actions').select('id, term, term_key, action, target_kind, target_name, alias_table, alias_id, undone_at').eq('id', id).maybeSingle()
  if (!a) return { ok: false, status: 404, error: 'That action was not found.' }
  if (a.undone_at) return { ok: true, id, message: 'Already undone.' }
  if (a.alias_table === 'taxonomy_aliases' && a.alias_id) {
    // The same rule as Settings → Subjects → Search words: a removed word is removed.
    const { error } = await admin.from('taxonomy_aliases').delete().eq('id', a.alias_id)
    if (error) return { ok: false, status: 400, error: 'That did not undo. Please try again.' }
  } else if (a.alias_table === 'location_area_aliases' && a.alias_id) {
    const { error } = await admin.from('location_area_aliases').update({ removed_at: new Date().toISOString(), removed_by: actor.id }).eq('id', a.alias_id)
    if (error) return { ok: false, status: 400, error: 'That did not undo. Please try again.' }
  }
  const { error } = await admin.from('search_term_actions').update({ undone_at: new Date().toISOString(), undone_by: actor.id }).eq('id', id).is('undone_at', null)
  if (error) return { ok: false, status: 400, error: 'That did not undo. Please try again.' }
  await logAdminAction({ ...auditWho(actor), action: a.action === 'alias' ? 'search_words.alias_undo' : 'search_words.demand_undo', targetType: 'search_term', targetId: String(id), detail: { term: a.term_key, target: a.target_name } })
  if (a.action === 'alias') refreshSearch(a.target_kind as AliasKind)
  return { ok: true, id, message: a.action === 'alias' ? `“${a.term}” no longer means ${a.target_name}.` : `“${a.term}” is off the wanted list.` }
}

function refreshSearch(kind: AliasKind) {
  invalidateMemoTag(SMART_SEARCH_TAG)
  if (kind === 'area') {
    invalidateMemoTag(AREA_ALIAS_TAG)
    revalidateLanding({ areas: true })
  }
}
