// lib/unmetSearches.ts
//
// Admin → Overview → "Unmet searches this week" (owner, 11 Oct 2026) — the I/O
// half (rules: lib/unmetSearchCore). ONE loader feeds the Overview number, the
// To review tab and the actions, so the tile always equals To review.
//
// Writes go through the service role and are audited:
//   • Add search word — the same taxonomy_aliases table Settings → Subjects
//     edits, then the search is run again and the new result counts come back;
//   • Mark done — a row in search_unmet_done (who, when, an optional note).
// Nothing is deleted.

import 'server-only'

import { revalidateTag } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import { pageAll } from '@/lib/pageAll'
import { rankedTutors } from '@/lib/browseTutors'
import { browseJobs } from '@/lib/jobFeed'
import { SMART_SEARCH_TAG, loadSearchDictFresh, resolveWith } from '@/lib/smartSearch'
import { parseQuery } from '@/lib/smartSearchCore'
import {
  HIRING_TEMPLATE_DEFAULT,
  HIRING_TEMPLATE_KEY,
  aliasKind,
  buildUnmet,
  cleanWord,
  searchKey,
  type DoneRow,
  type UnmetBoard,
  type UnmetRow,
  type WordTarget,
  type WordTargetKind,
} from '@/lib/unmetSearchCore'

export type Actor = { id: string; adminRole: AdminRole; email?: string | null }

const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'
const WINDOW_DAYS = 7
const DONE_DAYS = 30

/** The To review cards and the excluded count — the Overview number is toReview.length. */
export async function loadUnmetBoard(now = new Date()): Promise<UnmetBoard & { done: DoneRow[] }> {
  const admin = createAdminClient()
  if (!admin) return { toReview: [], excluded: 0, done: [] }
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const doneSince = new Date(now.getTime() - DONE_DAYS * 86_400_000).toISOString()
  const [rows, done] = await Promise.all([
    pageAll((a, b) =>
      admin.from('search_unmet').select('id, query, surface, city, subject, level, school, role, is_test, created_at').gte('created_at', since).order('id').range(a, b),
    ),
    pageAll((a, b) =>
      admin.from('search_unmet_done').select('id, query_key, query, searches, note, done_by_name, done_by_email, done_at').gte('done_at', doneSince).order('done_at', { ascending: false }).order('id').range(a, b),
    ),
  ])
  const board = buildUnmet(rows as UnmetRow[], done as DoneRow[])
  return { ...board, done: done as DoneRow[] }
}

/** Everything a Search word can point at, for the picker. */
export async function loadWordTargets(): Promise<WordTarget[]> {
  const dict = await loadSearchDictFresh()
  const out: WordTarget[] = []
  for (const s of dict.subjects) out.push({ kind: s.school ? 'school' : 'subject', slug: s.slug, name: s.name })
  for (const l of dict.levels) out.push({ kind: 'level', slug: l.slug, name: l.name })
  for (const c of dict.cities) out.push({ kind: 'city', slug: c, name: c })
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The hiring-post text, as edited in Team inbox → Templates. */
export async function loadHiringTemplate(): Promise<string> {
  const admin = createAdminClient()
  if (!admin) return HIRING_TEMPLATE_DEFAULT
  const { data } = await admin.from('admin_message_templates').select('body').eq('key', HIRING_TEMPLATE_KEY).maybeSingle()
  const body = (data?.body as string | null) ?? ''
  return body.trim() ? body : HIRING_TEMPLATE_DEFAULT
}

export type RerunResult = { tutors: number; tuitions: number; understood: boolean }

/** Run the search again, with the dictionary as it is in the database NOW. */
export async function rerunSearch(query: string): Promise<RerunResult> {
  const dict = await loadSearchDictFresh()
  const r = resolveWith(dict, parseQuery(query, dict))
  const city = r.understood ? (r.parsed.city ?? '') : ''
  const tutorMasters = r.understood ? (r.masterIds ?? r.levelMasterIds) : null
  const [tutors, jobs] = await Promise.all([
    rankedTutors({
      filters: { masterId: null, masterIds: tutorMasters, city, area: '', mode: '', gender: '', feeMin: '', feeMax: '', q: r.understood ? '' : query },
      limit: 1,
    }),
    browseJobs(
      { masterId: null, masterIds: r.understood ? r.masterIds : null, city: city || null, mode: null, budgetMin: null, budgetMax: null, q: r.understood ? null : query, levels: r.understood ? r.levelNames : null },
      1,
    ),
  ])
  return { tutors: tutors.total, tuitions: jobs.total, understood: r.understood }
}

export type AddWordResult = { ok: true; word: string; target: string; now: RerunResult } | { ok: false; status: 400 | 503; error: string }

/**
 * Attach a search word to a subject, school, level or city — the same table and
 * rule as Settings → Subjects → Search words — then run the search again.
 */
export async function addSearchWord(input: { query: string; word: string; kind: WordTargetKind; slug: string }, actor: Actor): Promise<AddWordResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const word = cleanWord(input.word)
  if (!word) return { ok: false, status: 400, error: 'A search word is 2 to 40 characters long.' }

  const target = (await loadWordTargets()).find((t) => t.kind === input.kind && t.slug === input.slug)
  if (!target) return { ok: false, status: 400, error: 'Choose a subject, school, level or city from the list.' }
  const kind = aliasKind(target.kind)

  const { data: have } = await admin.from('taxonomy_aliases').select('id').eq('kind', kind).eq('slug', target.slug).eq('alias', word).maybeSingle()
  if (!have) {
    const { error } = await admin.from('taxonomy_aliases').insert({ kind, slug: target.slug, alias: word, created_by: actor.id })
    if (error && error.code !== '23505') return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email ?? null,
      action: 'taxonomy.search_words',
      targetType: kind === 'subject' ? 'taxonomy_subject' : kind === 'level' ? 'taxonomy_level' : 'location_city',
      targetId: target.slug,
      detail: { changed: [{ [target.kind]: target.name, added: [word], removed: [] }], from: 'unmet_searches', search: input.query.slice(0, 200) },
    })
    revalidateTag(SMART_SEARCH_TAG, 'max')
  }
  return { ok: true, word, target: target.name, now: await rerunSearch(input.query) }
}

/** "Mark done": the card moves to Done. A later identical search makes a new card. */
export async function markSearchDone(input: { query: string; note: string | null; kind?: 'done' | 'ignored' | 'subject' | 'school' }, actor: Actor): Promise<{ ok: true } | { ok: false; status: 400 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const key = searchKey(input.query)
  if (!key) return { ok: false, status: 400, error: 'That search was not found. Reload the page and try again.' }
  const board = await loadUnmetBoard()
  const card = board.toReview.find((c) => c.key === key)
  if (!card) return { ok: false, status: 400, error: 'That search is no longer waiting for review. Reload the page.' }

  const note = input.note?.trim().slice(0, 500) || null
  const { data: who } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const { error } = await admin.from('search_unmet_done').insert({
    query_key: key,
    query: card.query,
    searches: card.count,
    note,
    done_by: actor.id,
    done_by_email: actor.email ?? null,
    done_by_name: (who?.full_name as string | null) ?? null,
    ...(input.kind && input.kind !== 'done' ? { kind: input.kind } : {}),
  })
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: input.kind === 'ignored' ? 'search.ignore' : input.kind === 'school' ? 'search.link_school' : 'search_unmet.done',
    targetType: 'search',
    targetId: key.slice(0, 200),
    detail: { searches: card.count, note, before: 'To review', after: input.kind === 'ignored' ? 'Ignored' : input.kind === 'school' ? 'Linked to school' : 'Done' },
  })
  return { ok: true }
}

/** The live levels a new subject can be added under (Unmet searches → "Add as new subject"). */
export async function loadSubjectLevels(): Promise<{ slug: string; name: string }[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data: levels }, { data: cats }] = await Promise.all([
    admin.from('taxonomy_levels').select('slug, name, category_slug, sort_order, legacy').eq('legacy', false),
    admin.from('taxonomy_categories').select('slug, name, sort_order'),
  ])
  const cat = new Map((cats ?? []).map((c) => [c.slug as string, { name: c.name as string, order: (c.sort_order as number | null) ?? 0 }]))
  return (levels ?? [])
    .map((l) => ({
      slug: l.slug as string,
      name: `${cat.get(l.category_slug as string)?.name ?? ''} › ${l.name as string}`,
      _c: cat.get(l.category_slug as string)?.order ?? 0,
      _l: (l.sort_order as number | null) ?? 0,
    }))
    .sort((a, b) => a._c - b._c || a._l - b._l)
    .map(({ slug, name }) => ({ slug, name }))
}

/**
 * Unmet searches → "Add as new subject" (owner, 13 Oct 2026). A subject is only
 * ever added by a staff member pressing this — never automatically from a
 * search. It adds the subject (or reuses one of the same name) under ONE level
 * the staff member chose, then marks the search done. Nothing is renamed or
 * removed. Audited.
 */
export async function addSubjectFromSearch(
  input: { query: string; name: string; levelSlug: string },
  actor: Actor,
): Promise<{ ok: true; subject: string; level: string } | { ok: false; status: 400 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const name = input.name.split(' ').filter(Boolean).join(' ').trim().slice(0, 80)
  if (name.length < 2) return { ok: false, status: 400, error: 'Enter the subject name.' }
  const { data: level } = await admin.from('taxonomy_levels').select('slug, name, category_slug, legacy').eq('slug', input.levelSlug).maybeSingle()
  if (!level || level.legacy) return { ok: false, status: 400, error: 'Choose a level for the new subject.' }

  // The same name (whatever its case) is the same subject.
  const { data: sameName } = await admin.from('taxonomy_subjects').select('slug, name').ilike('name', name).limit(1)
  let slug = (sameName?.[0]?.slug as string | undefined) ?? null
  const existed = !!slug
  if (!slug) {
    const base = name.toLowerCase().split(' ').join('-').split('').filter((ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-').join('') || 'subject'
    const { data: taken } = await admin.from('taxonomy_subjects').select('slug').eq('slug', base).maybeSingle()
    slug = taken ? `${base}-${Date.now().toString(36)}` : base
    const { error } = await admin.from('taxonomy_subjects').insert({ slug, name })
    if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  }
  const { data: link } = await admin
    .from('taxonomy_master')
    .select('id')
    .eq('category_slug', level.category_slug as string)
    .eq('level_slug', level.slug as string)
    .eq('subject_slug', slug)
    .maybeSingle()
  if (!link) {
    const { error } = await admin
      .from('taxonomy_master')
      .insert({ category_slug: level.category_slug as string, level_slug: level.slug as string, subject_slug: slug, leaf_type: 'subject' })
    if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'search.subject_add',
    targetType: 'taxonomy_subject',
    targetId: slug,
    detail: { search: input.query.slice(0, 200), before: existed ? `${name} (not at ${level.name as string})` : null, after: `${name} at ${level.name as string}` },
  })
  try {
    revalidateTag(SMART_SEARCH_TAG, 'max')
  } catch {
    /* not in a request scope */
  }
  // The search leaves "To review"; a failure here does not undo the subject.
  await markSearchDone({ query: input.query, note: `Added subject ${name} at ${level.name as string}`, kind: 'subject' }, actor).catch(() => undefined)
  return { ok: true, subject: name, level: level.name as string }
}

/**
 * "Link to school" (owner, 13 Oct 2026): the searched text is a school's name.
 * Nothing is added to subjects or search words — the search already shows the
 * school's row (lib/schoolSearch). The card leaves To review, recorded as
 * linked to that school. Refused when the text does not name a school.
 */
export async function linkSearchToSchool(input: { query: string }, actor: Actor): Promise<{ ok: true; school: string; href: string | null } | { ok: false; status: 400 | 503; error: string }> {
  const { schoolSuggestionFor } = await import('@/lib/schoolSearch')
  const school = await schoolSuggestionFor(input.query)
  if (!school) return { ok: false, status: 400, error: 'That search does not name a school we know.' }
  const done = await markSearchDone({ query: input.query, note: `School: ${school.name}${school.href ? ` (${school.href})` : ''}`, kind: 'school' }, actor)
  if (!done.ok) return done
  return { ok: true, school: school.name, href: school.href }
}

/** The To review cards, each marked with the school it names (if any). */
export async function withSchoolMatches<T extends { query: string }>(cards: T[]): Promise<(T & { schoolMatch: { name: string; href: string | null } | null })[]> {
  const { schoolSuggestionFor } = await import('@/lib/schoolSearch')
  return Promise.all(
    cards.map(async (c) => {
      const s = await schoolSuggestionFor(c.query)
      return { ...c, schoolMatch: s ? { name: s.name, href: s.href } : null }
    }),
  )
}
