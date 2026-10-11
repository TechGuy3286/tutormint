// lib/ignoredCredits.ts
//
// Bank credits marked "Ignore (not a sale)" (owner, 11 Oct 2026). Such a credit
// stays on record and stays listed under Bank credits, but it is NOT money from
// a sale — so every money total leaves it out: Finance "received in bank", the
// Settlement check's figures and the month CSV. Every reader of bank_transfers
// that adds amounts up filters through here, so one cannot forget.
// "Back to automatic" removes the mark and the credit counts again.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { NOT_A_SALE } from '@/lib/settlementMatchCore'

/** Ids of the bank credits currently marked "Ignore (not a sale)". */
export async function ignoredCreditIds(): Promise<Set<string>> {
  const admin = createAdminClient()
  if (!admin) return new Set()
  const rows = await pageAll((from, to) =>
    admin.from('settlement_links').select('id, transfer_id').eq('kind', 'none').eq('target', NOT_A_SALE).is('removed_at', null).order('id').range(from, to),
  )
  return new Set((rows as { transfer_id: string }[]).map((r) => String(r.transfer_id)))
}
