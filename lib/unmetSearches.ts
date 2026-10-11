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
export async function markSearchDone(input: { query: string; note: string | null }, actor: Actor): Promise<{ ok: true } | { ok: false; status: 400 | 503; error: string }> {
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
  })
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'search_unmet.done',
    targetType: 'search',
    targetId: key.slice(0, 200),
    detail: { searches: card.count, note },
  })
  return { ok: true }
}
