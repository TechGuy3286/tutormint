// lib/financeTabsCore.ts
//
// PURE, client-safe. Marketplace → Finance addresses.
//
// ONE page (owner, 21 Oct 2026). Finance used to have two tabs, Finance |
// Settlement check (owner, 15 Oct 2026); they are one page now with one month
// picker. The old addresses — /admin/finance?tab=settlement, ?tab=finance and
// /admin/finance/settlement — redirect to /admin/finance with their month /
// from / to kept. Same visibility as before: SCREEN_ACCESS.finance — the Owner,
// and the Project Managers view only. Every settlement action stays Owner only,
// enforced by its own route.

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Query keys the Finance page reads; everything else is dropped. */
const KEEP = ['month', 'from', 'to', 'show']

/** The Finance address, keeping the month / range (the old `tab` is dropped). */
export function financeHref(extra: Query = {}): string {
  const q = new URLSearchParams()
  for (const k of KEEP) {
    const val = one(extra[k])
    if (val != null && val !== '') q.set(k, val)
  }
  const s = q.toString()
  return s ? `/admin/finance?${s}` : '/admin/finance'
}

/** An address that still carries the old `tab` — the page redirects it. */
export function isLegacyFinanceQuery(sp: Query): boolean {
  return one(sp.tab) !== undefined
}
