// lib/finance.ts
//
// Admin → Finance (owner, 8 Oct 2026) — the I/O half. Reads approved payments,
// the plans (for each payment's audience), PayPro deduction lines and recorded
// bank transfers through the service role, and hands them to lib/financeCore.
//
// NO MEMBER CONTACT DETAILS ARE READ: no name, mobile or email — a payment is
// read by reference, plan, amount, approval time and payment method only.
// Every caller checks SCREEN_ACCESS.finance (or .revenue) first: owner, plus
// the view-only Partner.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { loadDeductions } from '@/lib/settlement'
import { methodLabel, summarise, type FinancePayment, type FinanceSummary, type FinanceTransfer } from '@/lib/financeCore'

type Row = {
  id: string
  provider_ref: string | null
  user_id: string | null
  plan_code: string | null
  amount_pkr: number | string | null
  refunded_amount_pkr: number | string | null
  refunded_at: string | null
  reviewed_at: string | null
  updated_at: string | null
  created_at: string
  provider: string | null
  method: string | null
  note: string | null
  raw: { paypro?: { paid?: { paymentVia?: unknown } } } | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Every APPROVED payment, mapped for the finance rules. Cached per request so
 *  the Overview card and its list read one set. */
export const loadFinancePayments = cache(async (): Promise<FinancePayment[]> => {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data }, { data: plans }] = await Promise.all([
    admin
      .from('payments')
      .select('id, provider_ref, user_id, plan_code, amount_pkr, refunded_amount_pkr, refunded_at, reviewed_at, updated_at, created_at, provider, method, note, raw')
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .limit(20000),
    admin.from('plans').select('code, audience'),
  ])
  const audience = new Map((plans ?? []).map((p) => [p.code as string, (p.audience as string | null) ?? null]))
  return ((data ?? []) as Row[]).map((p) => {
    const via = p.raw?.paypro?.paid?.paymentVia
    return {
      id: p.id,
      ref: p.provider_ref,
      userId: p.user_id,
      planCode: p.plan_code,
      audience: p.plan_code ? (audience.get(p.plan_code) ?? null) : null,
      amountPkr: num(p.amount_pkr),
      refundedAmountPkr: p.refunded_amount_pkr === null ? null : num(p.refunded_amount_pkr),
      refundedAt: p.refunded_at,
      approvedAt: p.reviewed_at ?? p.updated_at ?? p.created_at,
      provider: p.provider,
      method: methodLabel(typeof via === 'string' ? via : null, p.method, p.provider),
      note: p.note,
    }
  })
})

async function loadTransfers(): Promise<FinanceTransfer[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin.from('bank_transfers').select('gateway, transferred_on, amount_pkr').limit(20000)
  return (data ?? []).map((t) => ({
    gateway: String(t.gateway ?? 'paypro'),
    transferredOn: String(t.transferred_on),
    amountPkr: num(t.amount_pkr),
  }))
}

export async function loadFinance(now = new Date()): Promise<FinanceSummary> {
  const [payments, transfers, deductions] = await Promise.all([
    loadFinancePayments(),
    loadTransfers(),
    loadDeductions('paypro'),
  ])
  return summarise({ payments, transfers, deductions, nowIso: now.toISOString() })
}
