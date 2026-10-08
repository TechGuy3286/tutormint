/**
 * scripts/test-taxonomy-live.ts
 *
 *   npm run test:taxonomy:live
 *
 * A LIVE test (reads the one production DB with the anon key, like rls-audit) —
 * separate from the pure `test:taxonomy` because it needs the network. It guards
 * the regression the pure test cannot see: the picker is built from
 * `fetchTaxonomyTables` + `buildTaxonomy`, and `taxonomy_master` (4,500+ rows)
 * exceeds the PostgREST max-rows cap, so a non-paginated fetch returns an
 * arbitrary 1,000-row slice and the tree collapses to whichever categories
 * happened to land in it ("only Primary showed"). This asserts the paginated
 * fetch returns everything and the picker sees all 13 live categories / 29 grades.
 *
 * If the anon key is not configured it SKIPS (never a false green in CI without
 * network) — run it where .env.local has NEXT_PUBLIC_SUPABASE_URL + ANON_KEY.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

import { fetchTaxonomyTables, buildTaxonomy, orderSubjectsForPicker } from '../lib/taxonomyBuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function env(): Record<string, string> {
  try {
    const text = readFileSync(path.join(root, '.env.local'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i < 0) continue
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

const e = env()
const url = e.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = e.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

test('the picker sees all 14 live categories and every live grade (live, paginated past the 1000-row cap)', { skip: !url || !key ? 'no anon key configured' : false }, async () => {
  const sb = createClient(url!, key!)
  const tables = await fetchTaxonomyTables(sb)
  assert.ok(tables, 'taxonomy fetch failed')

  // Pagination actually beat the cap: a single PostgREST response is capped at
  // 1000, so a correct full fetch of master returns MORE than that.
  assert.ok(
    tables!.master.length > 1000,
    `expected >1000 master rows (paginated), got ${tables!.master.length} — the cap truncated the fetch`,
  )

  const { tree, rows } = buildTaxonomy(tables!)

  // The picker's category list is the tree's keys (non-legacy only).
  const categories = Object.keys(tree)
  assert.equal(
    categories.length,
    14,
    `expected 14 live categories (13 + Admission Test Prep, migration 153), got ${categories.length}: ${categories.sort().join(' | ')}`,
  )

  // Every live grade reaches the picker. The expected count is read from the
  // taxonomy itself — the non-legacy levels that carry at least one subject —
  // rather than a fixed number (29 at migration 80, 31 since migration 95 added
  // I Com and ICS), so adding a grade does not break this guard.
  const grades = categories.reduce((n, c) => n + Object.keys(tree[c]).length, 0)
  const withSubjects = new Set(tables!.master.map((m) => m.level_slug))
  const expected = tables!.levels.filter((l) => !l.legacy && withSubjects.has(l.slug)).length
  assert.ok(expected >= 31, `expected at least 31 live grades in the taxonomy, got ${expected}`)
  assert.equal(grades, expected, `expected ${expected} live grades in the picker, got ${grades}`)

  // The retired duplicate categories carry legacy rows but never leak into the
  // picker: they resolve for rendering (rows has them) but are absent from the tree.
  const legacyCats = new Set(rows.filter((r) => r.legacy).map((r) => r.category))
  for (const orphan of ['Pre-Primary / Pre-School', 'Matriculation', 'Holy Quran']) {
    assert.ok(legacyCats.has(orphan), `${orphan} should still resolve for legacy rows`)
    assert.ok(!categories.includes(orphan), `${orphan} must not appear in the picker`)
  }

  // A legacy selection still RENDERS by id (job cards / saved-subject chips):
  // rows carries retired masters with resolvable level+subject names.
  const legacyWithSubject = rows.find((r) => r.legacy && r.subject)
  assert.ok(legacyWithSubject, 'expected at least one retired master with a subject to still render')
  assert.ok(
    `${legacyWithSubject!.level} — ${legacyWithSubject!.subject}`.trim().length > 3,
    'a retired selection must render a non-empty label',
  )
})

test('the browse filters/typeahead never offer a retired subject (live RPCs)', { skip: !url || !key ? 'no anon key configured' : false }, async () => {
  const sb = createClient(url!, key!)
  const tables = await fetchTaxonomyTables(sb)
  assert.ok(tables, 'taxonomy fetch failed')
  const { rows } = buildTaxonomy(tables!)
  const legacyById = new Map(rows.map((r) => [r.id, r.legacy]))

  // search_suggest backs the browse typeahead (filter by subject with no level).
  const sug = await sb.rpc('search_suggest', { p_query: 'physics', p_limit: 10 })
  assert.ok(!sug.error, `search_suggest: ${sug.error?.message}`)
  const sugSubjects = (sug.data ?? []).filter((r: { grp: string }) => r.grp === 'subject')
  assert.ok(sugSubjects.length > 0, 'expected some subject suggestions for "physics"')
  for (const s of sugSubjects) {
    assert.equal(legacyById.get(Number(s.ref)), false, `suggested a retired subject: ${s.label} (${s.ref})`)
  }

  // popular_subjects backs the empty-query popular list.
  const pop = await sb.rpc('popular_subjects', { p_limit: 12 })
  assert.ok(!pop.error, `popular_subjects: ${pop.error?.message}`)
  for (const p of pop.data ?? []) {
    assert.equal(legacyById.get(Number(p.ref)), false, `popular listed a retired subject: ${p.label} (${p.ref})`)
  }
})

test('Admission Test Prep: a no-grade level with its 10 choices in order (live, migration 153)', { skip: !url || !key ? 'no anon key configured' : false }, async () => {
  const tables = await fetchTaxonomyTables(createClient(url!, key!))
  assert.ok(tables, 'taxonomy fetch failed')
  const { tree, noGrade } = buildTaxonomy(tables!)
  assert.ok(noGrade.includes('Admission Test Prep'), 'flagged no_grade')
  assert.deepEqual(noGrade, ['Admission Test Prep'], 'no other level lost its grades')
  const grades = Object.keys(tree['Admission Test Prep'] ?? {})
  assert.equal(grades.length, 1, 'exactly one implicit grade')
  assert.deepEqual(
    orderSubjectsForPicker(tree['Admission Test Prep'][grades[0]], 'Admission Test Prep', noGrade),
    [
      'Aitchison College', 'Crescent Model School Lahore', 'Beaconhouse School', 'Lahore Grammar School',
      'Karachi Grammar School', 'Cadet Colleges', 'NSSE', 'Sadiq Public School Bahawalpur',
      'Cadet College Hasanabdal', 'Other',
    ],
  )
})

