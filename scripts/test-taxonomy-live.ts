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

import { fetchTaxonomyTables, buildTaxonomy } from '../lib/taxonomyBuild'

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

test('the picker sees all 13 live categories and 29 grades (live, paginated past the 1000-row cap)', { skip: !url || !key ? 'no anon key configured' : false }, async () => {
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
    13,
    `expected 13 live categories, got ${categories.length}: ${categories.sort().join(' | ')}`,
  )

  // 29 grades = distinct (category, grade) across the non-legacy tree.
  const grades = categories.reduce((n, c) => n + Object.keys(tree[c]).length, 0)
  assert.equal(grades, 29, `expected 29 live grades, got ${grades}`)

  // The retired duplicate categories carry legacy rows but never leak into the
  // picker: they resolve for rendering (rows has them) but are absent from the tree.
  const legacyCats = new Set(rows.filter((r) => r.legacy).map((r) => r.category))
  for (const orphan of ['Pre-Primary / Pre-School', 'Matriculation', 'Holy Quran']) {
    assert.ok(legacyCats.has(orphan), `${orphan} should still resolve for legacy rows`)
    assert.ok(!categories.includes(orphan), `${orphan} must not appear in the picker`)
  }
})
