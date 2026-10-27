// lib/ignoredCredits.ts
//
// Bank credits that are NOT money from a sale (owner, 11 Oct 2026; widened
// 27 Oct 2026). Such a credit stays on record and stays listed under Bank
// credits, but every money total leaves it out: Finance "received in bank",
// the Settlement check's figures, PayPro settlement and the month CSV. Every
// reader of bank_transfers that adds amounts up filters through here, so one
// cannot forget. Three kinds:
//   • "Ignore (not a sale)"                    — settlement_links none / not_a_sale
//   • "Mark as duplicate — refund due"         — settlement_links none / refund_due
//   • "Owner / partner transfer (not revenue)" — bank_transfers.category
// "Back to automatic" (or a re-label back) removes the mark and it counts again.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { NOT_A_SALE, REFUND_DUE } from '@/lib/settlementMatchCore'

/** Ids of the bank credits that are not a sale, today. */
export async function ignoredCreditIds(): Promise<Set<string>> {
  const admin = createAdminClient()
  if (!admin) return new Set()
  const [rows, owner] = await Promise.all([
    pageAll((from, to) =>
      admin
        .from('settlement_links')
        .select('id, transfer_id')
        .eq('kind', 'none')
        .in('target', [NOT_A_SALE, REFUND_DUE])
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) => admin.from('bank_transfers').select('id').eq('category', 'owner_transfer').order('id').range(from, to)),
  ])
  return new Set([
    ...(rows as { transfer_id: string }[]).map((r) => String(r.transfer_id)),
    ...(owner as { id: string }[]).map((r) => String(r.id)),
  ])
}
