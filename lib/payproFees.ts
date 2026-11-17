import 'server-only'

// lib/payproFees.ts — PayPro's REAL fee per payment (owner, 17 Nov 2026 —
// PR-03). PayPro pays us in batches: a settlement of N × 193 covers N payments
// of Rs 199, so its fee is Rs 6 a payment. The settlements are the PayPro
// payout credits in Finance (bank_transfers gateway 'paypro' whose sender names
// PayPro — imported from the bank statement or entered by hand), less any set
// aside (ignored, personal, owner transfer). They are allocated to the approved
// PayPro payments by date and count (lib/bankStatementCore allocatePayproFees).
// Stored payments are never edited.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { ignoredCreditIds } from '@/lib/ignoredCredits'
import { allocatePayproFees, type FeeAllocation } from '@/lib/bankStatementCore'

export async function loadPayproFeeAllocation(): Promise<FeeAllocation | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [payments, transfers, ignored] = await Promise.all([
    pageAll<{ id: string; amount_pkr: number | null; reviewed_at: string | null; created_at: string }>((f, t) =>
      admin.from('payments').select('id, amount_pkr, reviewed_at, created_at').eq('provider', 'paypro').eq('status', 'approved').order('id').range(f, t),
    ),
    pageAll<{ id: string; transferred_on: string; amount_pkr: number; sender_name: string | null }>((f, t) =>
      admin.from('bank_transfers').select('id, transferred_on, amount_pkr, sender_name').eq('gateway', 'paypro').order('id').range(f, t),
    ),
    ignoredCreditIds(),
  ])
  const settlements = transfers
    .filter((t) => !ignored.has(String(t.id)) && /paypro/i.test(t.sender_name ?? ''))
    .map((t) => ({ id: String(t.id), date: String(t.transferred_on).slice(0, 10), amount: Number(t.amount_pkr) }))
  if (!settlements.length) return null
  return allocatePayproFees(
    payments.map((p) => ({ id: p.id, paidAt: p.reviewed_at ?? p.created_at, gross: Number(p.amount_pkr ?? 0) })),
    settlements,
  )
}
