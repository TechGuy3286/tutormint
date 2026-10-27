import 'server-only'

// lib/payproSettlement.ts — loads the PayPro settlement report (owner, 27 Oct
// 2026). Rules in lib/payproSettlementCore.ts. Service role; read only.
//
//   payments  — every approved PayPro payment (provider 'paypro'), dated by
//               approval; the member's name only (never a contact detail).
//   export    — the current PayPro export rows (reconciliation_rows,
//               gateway 'paypro', is_current), matched on the order number.
//   payouts   — Finance credits recorded as a PayPro payout
//               (bank_transfers.gateway = 'paypro'), less any marked
//               "Ignore (not a sale)".

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { ignoredCreditIds } from '@/lib/ignoredCredits'
import { buildSettlement, splitPayouts, typicalFees, type PayoutIn, type PayproPaymentIn, type SettlementReport } from '@/lib/payproSettlementCore'

export type PayproSettlement = SettlementReport & { notFromPaypro: PayoutIn[] }

export async function loadPayproSettlement(now = new Date()): Promise<PayproSettlement | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [payments, rows, transfers, ignored] = await Promise.all([
    pageAll<{ id: string; user_id: string | null; provider_ref: string | null; amount_pkr: number | null; reviewed_at: string | null; created_at: string; refunded_amount_pkr: number | null; refunded_at: string | null; note: string | null }>((from, to) =>
      admin
        .from('payments')
        .select('id, user_id, provider_ref, amount_pkr, reviewed_at, created_at, refunded_amount_pkr, refunded_at, note')
        .eq('provider', 'paypro')
        .eq('status', 'approved')
        .order('id')
        .range(from, to),
    ),
    pageAll<{ order_number: string; order_amount: number | null; merchant_share: number | null }>((from, to) =>
      admin.from('reconciliation_rows').select('order_number, order_amount, merchant_share').eq('gateway', 'paypro').eq('is_current', true).order('id').range(from, to),
    ),
    pageAll<{ id: string; transferred_on: string; amount_pkr: number; sender_name: string | null }>((from, to) =>
      admin.from('bank_transfers').select('id, transferred_on, amount_pkr, sender_name').eq('gateway', 'paypro').order('id').range(from, to),
    ),
    ignoredCreditIds(),
  ])
  const userIds = [...new Set(payments.map((p) => p.user_id).filter((x): x is string => !!x))]
  const people = await pageAllIn<{ id: string; full_name: string | null }, string>(userIds, (part, from, to) =>
    admin.from('profiles').select('id, full_name').in('id', part).order('id').range(from, to),
  )
  const nameBy = new Map(people.map((p) => [p.id, formatName(p.full_name ?? '') || 'Member']))
  const exportBy = new Map(rows.map((r) => [r.order_number.trim().toUpperCase(), r]))

  const ins: PayproPaymentIn[] = payments.map((p) => {
    const ref = (p.provider_ref ?? '').trim()
    const ex = exportBy.get(ref.toUpperCase())
    return {
      id: p.id,
      ref: ref || p.id,
      paidAt: p.reviewed_at ?? p.created_at,
      member: p.user_id ? (nameBy.get(p.user_id) ?? 'Member') : 'Deleted account',
      gross: Number(p.amount_pkr ?? 0),
      exportAmount: ex?.order_amount != null ? Number(ex.order_amount) : null,
      exportShare: ex?.merchant_share != null ? Number(ex.merchant_share) : null,
      refundedPkr: Number(p.refunded_amount_pkr ?? 0),
      refundedAt: p.refunded_at,
    }
  })
  const live = transfers.filter((t) => !ignored.has(String(t.id)))
  const { payouts, notFromPaypro } = splitPayouts(live.map((t) => ({ id: t.id, date: t.transferred_on, amount: Number(t.amount_pkr), sender: t.sender_name })))
  const typical = typicalFees(rows.map((r) => ({ amount: r.order_amount != null ? Number(r.order_amount) : null, share: r.merchant_share != null ? Number(r.merchant_share) : null })))
  return { ...buildSettlement(ins, payouts, typical, now), notFromPaypro }
}
