// lib/subjectsCore.ts
//
// Admin → Settings → Subjects (owner, 7 Oct 2026): which subjects are a level's
// "Main subjects" — what the post-a-tuition "Main subjects" chip adds for a
// grade. Reads and writes ONLY taxonomy_master.is_core (migration 146): this
// screen never adds, renames or deletes a subject. Every save is audit-logged.

import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'

export type LevelOption = { slug: string; name: string; category: string; coreCount: number }
export type LevelSubject = { masterId: number; slug: string; name: string; isCore: boolean; nameUr: string | null; searchWords: string[] }

export async function listLevels(): Promise<LevelOption[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data: cats }, { data: levels }, coreRows] = await Promise.all([
    admin.from('taxonomy_categories').select('slug, name, sort_order'),
    admin.from('taxonomy_levels').select('slug, name, category_slug, sort_order, legacy').eq('legacy', false),
    pageAll((from, to) => admin.from('taxonomy_master').select('id, level_slug').eq('is_core', true).order('id').range(from, to)).then((data) => ({ data })),
  ])
  const cat = new Map((cats ?? []).map((c) => [c.slug as string, { name: c.name as string, order: (c.sort_order as number | null) ?? 0 }]))
  const coreBy = new Map<string, number>()
  for (const r of coreRows.data ?? []) coreBy.set(r.level_slug as string, (coreBy.get(r.level_slug as string) ?? 0) + 1)
  return (levels ?? [])
    .map((l) => ({
      slug: l.slug as string,
      name: l.name as string,
      category: cat.get(l.category_slug as string)?.name ?? '',
      coreCount: coreBy.get(l.slug as string) ?? 0,
      _c: cat.get(l.category_slug as string)?.order ?? 0,
      _l: (l.sort_order as number | null) ?? 0,
    }))
    .sort((a, b) => a._c - b._c || a._l - b._l)
    .map(({ slug, name, category, coreCount }) => ({ slug, name, category, coreCount }))
}

export async function levelSubjects(levelSlug: string): Promise<LevelSubject[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: level } = await admin.from('taxonomy_levels').select('slug, legacy').eq('slug', levelSlug).maybeSingle()
  if (!level || level.legacy) return []
  const { data: rows } = await admin
    .from('taxonomy_master')
    .select('id, subject_slug, is_core')
    .eq('level_slug', levelSlug)
    .not('subject_slug', 'is', null)
    .limit(1000)
  const slugs = [...new Set((rows ?? []).map((r) => r.subject_slug as string))]
  const { data: subs } = slugs.length
    ? await admin.from('taxonomy_subjects').select('slug, name, name_ur').in('slug', slugs)
    : { data: [] as { slug: string; name: string; name_ur: string | null }[] }
  const name = new Map((subs ?? []).map((s) => [s.slug as string, s.name as string]))
  const ur = new Map((subs ?? []).map((s) => [s.slug as string, ((s.name_ur as string | null) ?? '').trim() || null]))
  const { data: aliasRows } = slugs.length
    ? await admin.from('taxonomy_aliases').select('slug, alias').eq('kind', 'subject').in('slug', slugs).order('alias')
    : { data: [] as { slug: string; alias: string }[] }
  const words = new Map<string, string[]>()
  for (const a of aliasRows ?? []) (words.get(a.slug as string) ?? words.set(a.slug as string, []).get(a.slug as string)!).push(a.alias as string)
  return (rows ?? [])
    .map((r) => ({
      masterId: r.id as number,
      slug: r.subject_slug as string,
      name: name.get(r.subject_slug as string) ?? '',
      isCore: !!r.is_core,
      nameUr: ur.get(r.subject_slug as string) ?? null,
      searchWords: words.get(r.subject_slug as string) ?? [],
    }))
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Set a level's main subjects to exactly `coreIds` (ids of THAT level only). */
export async function saveLevelCore(
  levelSlug: string,
  coreIds: number[],
  actor: { id: string; adminRole: AdminRole; email?: string | null },
): Promise<{ ok: true; added: string[]; removed: string[] } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: level } = await admin.from('taxonomy_levels').select('slug, name, legacy').eq('slug', levelSlug).maybeSingle()
  if (!level || level.legacy) return { ok: false, error: 'That level was not found.' }

  const current = await levelSubjects(levelSlug)
  const known = new Map(current.map((s) => [s.masterId, s]))
  const want = new Set(coreIds)
  for (const id of want) if (!known.has(id)) return { ok: false, error: 'A subject in that list does not belong to this level.' }

  const toOn = current.filter((s) => !s.isCore && want.has(s.masterId))
  const toOff = current.filter((s) => s.isCore && !want.has(s.masterId))
  if (toOn.length === 0 && toOff.length === 0) return { ok: true, added: [], removed: [] }

  if (toOn.length) {
    const { error } = await admin.from('taxonomy_master').update({ is_core: true }).in('id', toOn.map((s) => s.masterId))
    if (error) return { ok: false, error: 'That did not save. Please try again.' }
  }
  if (toOff.length) {
    const { error } = await admin.from('taxonomy_master').update({ is_core: false }).in('id', toOff.map((s) => s.masterId))
    if (error) return { ok: false, error: 'That did not save. Please try again.' }
  }

  const added = toOn.map((s) => s.name)
  const removed = toOff.map((s) => s.name)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'taxonomy.core',
    targetType: 'taxonomy_level',
    targetId: levelSlug,
    detail: { level: level.name, added, removed },
  })
  return { ok: true, added, removed }
}

/** Normalise a typed Urdu name: trimmed, inner spaces collapsed, '' → null. */
export function cleanUrduName(v: string | null | undefined): string | null {
  const t = (v ?? '').replace(/s+/g, ' ').trim()
  return t ? t.slice(0, 60) : null
}

/**
 * Set short Urdu subject names (migration 149). The name belongs to the SUBJECT,
 * so it shows at every level that subject is offered. Only names that actually
 * change are written, and each change is audited with its before and after.
 */
export async function saveUrduNames(
  names: Record<string, string | null>,
  actor: { id: string; adminRole: AdminRole; email?: string | null },
): Promise<{ ok: true; changed: { subject: string; from: string | null; to: string | null }[] } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  const slugs = Object.keys(names)
  if (slugs.length === 0) return { ok: true, changed: [] }
  const { data: subs } = await admin.from('taxonomy_subjects').select('slug, name, name_ur').in('slug', slugs)
  const changed: { subject: string; from: string | null; to: string | null }[] = []
  for (const sub of subs ?? []) {
    const before = ((sub.name_ur as string | null) ?? '').trim() || null
    const after = cleanUrduName(names[sub.slug as string])
    if (before === after) continue
    const { error } = await admin.from('taxonomy_subjects').update({ name_ur: after }).eq('slug', sub.slug as string)
    if (error) return { ok: false, error: 'That did not save. Please try again.' }
    changed.push({ subject: sub.name as string, from: before, to: after })
  }
  if (changed.length) {
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email ?? null,
      action: 'taxonomy.urdu_name',
      targetType: 'taxonomy_subject',
      targetId: slugs.length === 1 ? slugs[0] : 'multiple',
      detail: { changed },
    })
  }
  return { ok: true, changed }
}

/** Normalise typed search words: comma-separated, lowercase, trimmed, unique. */
export function cleanSearchWords(v: string | string[] | null | undefined): string[] {
  const list = Array.isArray(v) ? v : (v ?? '').split(',')
  return [...new Set(list.map((w) => w.toLowerCase().replace(/\s+/g, ' ').trim()).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, 30)
}

/**
 * Set the "Search words" of subjects (owner, 8 Oct 2026): short forms and Roman
 * Urdu the ONE smart search matches (math → Mathematics). Per SUBJECT, so they
 * work at every level. Only real changes are written; each is audited.
 */
export async function saveSearchWords(
  words: Record<string, string[]>,
  actor: { id: string; adminRole: AdminRole; email?: string | null },
): Promise<{ ok: true; changed: { subject: string; added: string[]; removed: string[] }[] } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  const slugs = Object.keys(words)
  if (slugs.length === 0) return { ok: true, changed: [] }
  const [{ data: subs }, { data: rows }] = await Promise.all([
    admin.from('taxonomy_subjects').select('slug, name').in('slug', slugs),
    admin.from('taxonomy_aliases').select('id, slug, alias').eq('kind', 'subject').in('slug', slugs),
  ])
  const changed: { subject: string; added: string[]; removed: string[] }[] = []
  for (const sub of subs ?? []) {
    const slug = sub.slug as string
    const want = new Set(cleanSearchWords(words[slug]))
    const have = (rows ?? []).filter((r) => r.slug === slug)
    const haveSet = new Set(have.map((r) => r.alias as string))
    const added = [...want].filter((w) => !haveSet.has(w))
    const removedRows = have.filter((r) => !want.has(r.alias as string))
    if (!added.length && !removedRows.length) continue
    if (added.length) {
      const { error } = await admin.from('taxonomy_aliases').insert(added.map((alias) => ({ kind: 'subject', slug, alias, created_by: actor.id })))
      if (error) return { ok: false, error: 'That did not save. Please try again.' }
    }
    if (removedRows.length) {
      const { error } = await admin.from('taxonomy_aliases').delete().in('id', removedRows.map((r) => r.id as number))
      if (error) return { ok: false, error: 'That did not save. Please try again.' }
    }
    changed.push({ subject: sub.name as string, added, removed: removedRows.map((r) => r.alias as string) })
  }
  if (changed.length) {
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email ?? null,
      action: 'taxonomy.search_words',
      targetType: 'taxonomy_subject',
      targetId: slugs.length === 1 ? slugs[0] : 'multiple',
      detail: { changed },
    })
  }
  return { ok: true, changed }
}
