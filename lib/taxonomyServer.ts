// lib/taxonomyServer.ts
//
// SERVER-side taxonomy lookups (hotfix, 7 Oct 2026). lib/taxonomy.ts loads the
// taxonomy through the BROWSER client (lib/supabase/clientLazy, 'use client'
// since bb07fbd), so any API route calling it threw at runtime:
//   "Attempted to call getBrowserClient() from the server but getBrowserClient
//    is on the client."
// — every tutor subject save that changed subjects returned 500. Server code
// imports THIS module instead; `npm run check:server-imports` fails the build
// if server code reaches a browser-only module again.
//
// Same fetch (paginated past the 1000-row cap) and the same pure derivation
// (lib/taxonomyBuild) as the browser path, read with the server Supabase client.
// The taxonomy is world-readable reference data, so the built result is cached
// per server instance for 10 minutes; a failed fetch is never cached.

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  buildTaxonomy,
  fetchTaxonomyTables,
  labelsFromRows,
  selectionFromRows,
  type TaxonomyRow,
  type TaxonomySelection,
} from '@/lib/taxonomyBuild'

const TTL_MS = 10 * 60 * 1000
let cache: { at: number; rows: TaxonomyRow[] } | null = null

async function rows(): Promise<TaxonomyRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  const tables = await fetchTaxonomyTables(await createClient())
  if (!tables) throw new Error('taxonomy fetch failed')
  const built = buildTaxonomy(tables)
  cache = { at: Date.now(), rows: built.rows }
  return built.rows
}

/** "Grade 1 — Mathematics" labels for saved master ids (legacy included). */
export async function labelsForMasterIdsServer(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return []
  return labelsFromRows(await rows(), ids)
}

/** Saved master ids → the cascade selection (category, levels, subjects). */
export async function selectionForMasterIdsServer(ids: number[]): Promise<TaxonomySelection> {
  if (ids.length === 0) return selectionFromRows([], ids)
  return selectionFromRows(await rows(), ids)
}
