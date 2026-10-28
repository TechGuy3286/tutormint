// lib/cardGridPagingCore.ts
//
// PURE. The admin card grid worked out on the SERVER (owner, 28 Oct 2026:
// "Admin lists load 25 items at a time with 'Load more', with counts and
// filters computed on the server. Search still covers everything.").
//
// People (Tutors / Parents) used to send every card to the browser, which
// searched, filtered, counted and showed 48 at a time. Now the server takes the
// whole list and, in this order — the order the browser used:
//   1. the search (name, details, city, the badge, the hidden search text —
//      email and mobile — and, when 4+ digits are typed, the mobile digits);
//   2. each chip row in turn — a row's counts are over what the search and the
//      rows above it leave, so a chip's number is exactly what it shows;
//   3. the Documents chips (Tutors), counted over what step 2 leaves;
// then sends the first 25 (lib/adminPagingCore). Only those 25 need their card
// facts (photo, completion, share link), so only those are loaded.

import { pageSlice, withShown, type PageSlice } from '@/lib/adminPagingCore'
import { applyDocFilter, docFilterCounts, isDocFilter, type DocFilter, type DocSummaryKind } from '@/lib/tutorDocSummaryCore'

export type ChipRowSpec = { param: string; options: { key: string }[] }

export type GridSearchable = {
  /** The fields the search box matches, in any case. */
  searchFields: (string | null | undefined)[]
  /** Extra text (email, mobile digits) — never shown. */
  searchText?: string
  tags?: Record<string, string>
  docs?: { kind: DocSummaryKind; oldestUploadAt: string | null } | null
}

/** The search box rule, unchanged from the browser version. */
export function gridSearchMatches(it: Pick<GridSearchable, 'searchFields' | 'searchText'>, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const digits = needle.replace(/\D/g, '')
  return (
    [...it.searchFields, it.searchText].some((v) => (v ?? '').toLowerCase().includes(needle)) ||
    (digits.length >= 4 && (it.searchText ?? '').includes(digits))
  )
}

/** Each row's chosen chip from the address; anything unknown is the row's first option. */
export function pickChips(rows: ChipRowSpec[], sp: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    rows.map((r) => {
      const raw = sp[r.param]
      const v = Array.isArray(raw) ? raw[0] : raw
      return [r.param, v && r.options.some((o) => o.key === v) ? v : r.options[0].key]
    }),
  )
}

export function pickDocFilter(raw: string | string[] | undefined): DocFilter {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v && isDocFilter(v) ? v : 'all'
}

export type GridViewResult<T> = {
  /** Every card before the search. */
  allCount: number
  /** Cards the search leaves. */
  searchedCount: number
  rowCounts: Record<string, Record<string, number>>
  docCounts: Record<DocFilter, number> | null
  /** The cards shown, and how many the filters leave in all. */
  page: PageSlice<T>
}

export function gridView<T extends GridSearchable>(
  items: T[],
  opts: { q: string; rows: ChipRowSpec[]; sel: Record<string, string>; docFilter: DocFilter | null; shown: number },
): GridViewResult<T> {
  const searched = items.filter((it) => gridSearchMatches(it, opts.q))
  let pool = searched
  const rowCounts: Record<string, Record<string, number>> = {}
  for (const row of opts.rows) {
    const c: Record<string, number> = {}
    for (const o of row.options) c[o.key] = o.key === 'all' ? pool.length : pool.filter((it) => it.tags?.[row.param] === o.key).length
    rowCounts[row.param] = c
    const chosen = opts.sel[row.param] ?? row.options[0].key
    if (chosen !== 'all') pool = pool.filter((it) => it.tags?.[row.param] === chosen)
  }
  const docCounts = opts.docFilter ? docFilterCounts(pool) : null
  const filtered = opts.docFilter ? applyDocFilter(pool, opts.docFilter) : pool
  return { allCount: items.length, searchedCount: searched.length, rowCounts, docCounts, page: pageSlice(filtered, opts.shown) }
}

/**
 * A chip or search link: the same page with one value changed, back at the
 * first 25 (no ?n=). Default values are left out of the address.
 */
export function gridHref(
  basePath: string,
  state: { keep: Record<string, string | undefined>; q: string; sel: Record<string, string>; docFilter: DocFilter | null },
  rows: ChipRowSpec[],
  change: Record<string, string>,
): string {
  const params: Record<string, string | undefined> = { ...state.keep }
  for (const r of rows) {
    const v = change[r.param] ?? state.sel[r.param] ?? r.options[0].key
    params[r.param] = v === r.options[0].key ? undefined : v
  }
  if (state.docFilter) {
    const d = change.docs ?? state.docFilter
    params.docs = d === 'all' ? undefined : d
  }
  const q = (change.q ?? state.q).trim()
  params.q = q || undefined
  return withShown(basePath, params, null)
}
