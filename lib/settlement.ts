// lib/settlement.ts
//
// Settlement check per payment gateway (owner, 6 Oct 2026) — the I/O half.
// Reads our approved payments, the gateway's latest uploaded file, the bank
// transfers and the deduction lines, and hands them to lib/settlementCore.
// Writes (deduction lines) go through the service role and are audit-logged.
// Nothing here changes a payment's status.
//
// No member name, mobile or email is read: payments are read by reference,
// amount, approval time and payment method only.

import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import type { PayproRow, Transfer } from '@/lib/reconciliationCore'
import { settle, settleByDate, deductionProblem, dayInRange, pkDay, type Deduction, type DueOrder, type OurPayment, type SettleGroup, type SettlementResult } from '@/lib/settlementCore'

export type Actor = { id: string; adminRole: AdminRole; email?: string | null }

export type SettlementView = {
  gateway: string
  result: SettlementResult
  latestImport: { filename: string | null; rowCount: number; periodFrom: string | null; periodTo: string | null; createdAt: string } | null
  transfers: (Transfer & { id: string; source: string })[]
  deductions: Deduction[]
  /** Per settle date (owner, 8 Oct 2026) — only when the gateway file carries
   *  Settle-Dates. Groups whose settle date is in the range, plus every PAID
   *  order not yet settled ("Due from PayPro"). */
  perSettle: { groups: SettleGroup[]; due: DueOrder[] } | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

type PaymentRow = {
  provider_ref: string | null
  amount_pkr: number | string | null
  reviewed_at: string | null
  updated_at: string | null
  created_at: string
  method: string | null
  raw: { paypro?: { paid?: { paymentVia?: unknown } } } | null
}

async function approvedPayments(gateway: string): Promise<OurPayment[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const data = await pageAll((from, to) =>
    admin
      .from('payments')
      .select('id, provider_ref, amount_pkr, reviewed_at, updated_at, created_at, method, raw')
      .eq('provider', gateway)
      .eq('status', 'approved')
      .order('id')
      .range(from, to),
  )
  return ((data ?? []) as PaymentRow[])
    .filter((p) => !!p.provider_ref)
    .map((p) => {
      const via = p.raw?.paypro?.paid?.paymentVia
      return {
        ref: p.provider_ref as string,
        amountPkr: num(p.amount_pkr) ?? 0,
        approvedAt: p.reviewed_at ?? p.updated_at ?? p.created_at,
        method: typeof via === 'string' && via.trim() ? via.trim() : (p.method ?? null),
      }
    })
}

export async function loadDeductions(gateway: string): Promise<Deduction[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('gateway_deductions')
    .select('id, name, percent, fixed_pkr, effective_from')
    .eq('gateway', gateway)
    .is('removed_at', null)
    .order('effective_from', { ascending: true })
  return ((data ?? []) as { id: string; name: string; percent: unknown; fixed_pkr: unknown; effective_from: string }[]).map((d) => ({
    id: d.id,
    name: d.name,
    percent: num(d.percent),
    fixedPkr: num(d.fixed_pkr),
    effectiveFrom: d.effective_from,
  }))
}

export async function loadSettlement(gateway: string, from: string, to: string): Promise<SettlementView | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const [approved, deductions, impRes, trRes] = await Promise.all([
    approvedPayments(gateway),
    loadDeductions(gateway),
    admin
      .from('reconciliation_imports')
      .select('id, filename, row_count, period_from, period_to, created_at')
      .eq('gateway', gateway)
      .order('created_at', { ascending: false })
      .limit(1),
    pageAll((from, to) =>
      admin
        .from('bank_transfers')
        .select('id, transferred_on, amount_pkr, reference, account_last4, source')
        .eq('gateway', gateway)
        .order('transferred_on', { ascending: false })
        .order('id')
        .range(from, to),
    ).then((data) => ({ data })),
  ])

  const latest = (impRes.data ?? [])[0] as
    | { id: string; filename: string | null; row_count: number | null; period_from: string | null; period_to: string | null; created_at: string }
    | undefined

  let gatewayRows: PayproRow[] | null = null
  if (latest) {
    const data = await pageAll((from, to) =>
      admin
        .from('reconciliation_rows')
        .select('id, order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
        .eq('import_id', latest.id)
        .order('id')
        .range(from, to),
    )
    gatewayRows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      orderNumber: String(r.order_number ?? ''),
      transactionStatus: (r.transaction_status as string | null) ?? null,
      paymentVia: (r.payment_via as string | null) ?? null,
      orderAmount: num(r.order_amount),
      merchantShare: num(r.merchant_share),
      datePaid: (r.date_paid as string | null) ?? null,
      settleDate: (r.settle_date as string | null) ?? null,
      settleStatus: (r.settle_status as string | null) ?? null,
    }))
  }

  const allTransfers = ((trRes.data ?? []) as Record<string, unknown>[]).map((t) => ({
    id: String(t.id),
    source: String(t.source ?? ''),
    transferredOn: String(t.transferred_on),
    amountPkr: num(t.amount_pkr) ?? 0,
    reference: (t.reference as string | null) ?? null,
    accountLast4: (t.account_last4 as string | null) ?? null,
  }))

  const result = settle({ from, to, approved, gatewayRows, transfers: allTransfers, deductions })

  // Per settle date: matched against ALL recorded transfers (the window can reach
  // a day either side of the range), then shown for groups inside the range.
  const hasSettleDates = (gatewayRows ?? []).some((r) => !!r.settleDate)
  let perSettle: SettlementView['perSettle'] = null
  if (gatewayRows && hasSettleDates) {
    const all = settleByDate(gatewayRows, allTransfers, new Date().toISOString())
    perSettle = { groups: all.groups.filter((g) => dayInRange(g.settleDate, from, to)), due: all.due }
  }

  return {
    gateway,
    result,
    latestImport: latest
      ? {
          filename: latest.filename,
          rowCount: latest.row_count ?? gatewayRows?.length ?? 0,
          periodFrom: latest.period_from,
          periodTo: latest.period_to,
          createdAt: latest.created_at,
        }
      : null,
    transfers: allTransfers.filter((t) => dayInRange(t.transferredOn, from, to)),
    deductions,
    perSettle,
  }
}

/** Our approved payments in the range, for the download. No personal fields. */
export async function settlementExportRows(
  gateway: string,
  from: string,
  to: string,
): Promise<{ approvedAt: string; ref: string; amountPkr: number; method: string | null }[]> {
  const approved = await approvedPayments(gateway)
  return approved
    .filter((p) => dayInRange(pkDay(p.approvedAt), from, to))
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
}

export async function addDeduction(
  gateway: string,
  input: { name: string; percent: number | null; fixedPkr: number | null; effectiveFrom: string },
  actor: Actor,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const problem = deductionProblem(input)
  if (problem) return { ok: false, error: problem }
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data, error } = await admin
    .from('gateway_deductions')
    .insert({
      gateway,
      name: input.name.trim().slice(0, 80),
      percent: input.percent,
      fixed_pkr: input.fixedPkr,
      effective_from: input.effectiveFrom,
      created_by: actor.id,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.deduction_add',
    targetType: 'gateway_deduction',
    targetId: data.id,
    detail: { gateway, name: input.name.trim(), percent: input.percent, fixedPkr: input.fixedPkr, effectiveFrom: input.effectiveFrom },
  })
  return { ok: true, id: data.id }
}

/** Soft removal: the line stops applying; the row is kept. */
export async function removeDeduction(
  gateway: string,
  id: string,
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: row } = await admin
    .from('gateway_deductions')
    .select('id, name, percent, fixed_pkr, effective_from, removed_at')
    .eq('id', id)
    .eq('gateway', gateway)
    .maybeSingle()
  if (!row || row.removed_at) return { ok: false, error: 'That deduction line was not found.' }
  const { error } = await admin
    .from('gateway_deductions')
    .update({ removed_at: new Date().toISOString(), removed_by: actor.id })
    .eq('id', id)
  if (error) return { ok: false, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.deduction_remove',
    targetType: 'gateway_deduction',
    targetId: id,
    detail: { gateway, name: row.name, percent: row.percent, fixedPkr: row.fixed_pkr, effectiveFrom: row.effective_from },
  })
  return { ok: true }
}
