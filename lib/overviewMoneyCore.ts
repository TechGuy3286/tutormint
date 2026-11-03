// lib/overviewMoneyCore.ts
//
// PURE. Which Overview items carry rupees (owner, 3 Nov 2026). A role that may
// not see payment amounts (SCREEN_ACCESS.paymentAmounts — the Owner and the
// Partner only) never gets these items on the Overview or their list pages,
// whatever its other screen rights: revenue (a rupee total) and the PayPro
// payout row (order amounts). Every other item is a count.

import type { OverviewItemKey } from './overviewItemsCore'

export const MONEY_ITEM_KEYS: readonly OverviewItemKey[] = ['revenue', 'todo-due']

export function isMoneyItem(key: OverviewItemKey): boolean {
  return MONEY_ITEM_KEYS.includes(key)
}

export function overviewKeysWithoutMoney(keys: OverviewItemKey[], seesMoney: boolean): OverviewItemKey[] {
  return seesMoney ? keys : keys.filter((k) => !isMoneyItem(k))
}
