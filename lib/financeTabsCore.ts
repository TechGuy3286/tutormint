// lib/financeTabsCore.ts
//
// PURE, client-safe. Marketplace → Finance has two tabs (owner, 15 Oct 2026):
//   finance     the totals, month by month, by type and method (was Finance)
//   settlement  the settlement check (was its own page, /admin/finance/settlement)
// Same visibility as before: SCREEN_ACCESS.finance — the Owner, and the Project
// Managers view only. Every settlement action (upload the PayPro export, add a
// bank credit, link, ignore) stays Owner only, enforced by its own route.

export type FinanceTab = 'finance' | 'settlement'

export const FINANCE_TABS: { key: FinanceTab; label: string }[] = [
  { key: 'finance', label: 'Finance' },
  { key: 'settlement', label: 'Settlement check' },
]

export function pickFinanceTab(v: string | null | undefined): FinanceTab {
  return v === 'settlement' ? 'settlement' : 'finance'
}

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** A Finance address for a tab, keeping extra query (month, from, to). */
export function financeHref(tab: FinanceTab, extra: Query = {}): string {
  const q = new URLSearchParams()
  if (tab !== 'finance') q.set('tab', tab)
  for (const [k, v] of Object.entries(extra)) {
    const val = one(v)
    if (val != null && val !== '' && k !== 'tab') q.set(k, val)
  }
  const s = q.toString()
  return s ? `/admin/finance?${s}` : '/admin/finance'
}
