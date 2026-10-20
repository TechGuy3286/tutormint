// lib/settlementMatch.ts
//
// Settlements (owner, 11 Oct 2026) — the I/O half. Reads the stored PayPro
// orders, the bank credits, our own payments and the owner's manual links, and
// hands them to lib/settlementMatchCore. Writes (a bank credit, a manual link)
// go through the service role and are audit-logged. Nothing here changes a
// payment's status.
//
// It uses the settlement-check tables that already existed (reconciliation_rows,
// bank_transfers) plus settlement_links (migration 162).
//
// The ONE personal field read here is the payer's name on an APPROVED
// bank-transfer receipt, used to prefer a credit from the same sender. It is
// shown on the owner-only page and never written to the CSV.

import 'server-only'

import { pageAll } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import type { PayproRow } from '@/lib/reconciliationCore'
import { pkDay } from '@/lib/settlementCore'
import {
  buildBoard,
  creditProblem,
  matchSummary,
  monthView,
  NOT_A_SALE,
  refKey,
  type Credit,
  type ManualLink,
  type MonthView,
  type OurPaypro,
  type Receipt,
} from '@/lib/settlementMatchCore'

export type Actor = { id: string; adminRole: AdminRole; email?: string | null }

const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export type OpenOrder = { orderNumber: string; method: string; merchantShare: number | null; settleDate: string | null; datePaid: string | null }
export type OpenReceipt = { id: string; ref: string; amountPkr: number; approvedDay: string; payerName: string | null }

export type SettlementsBoard = {
  view: MonthView
  hasExport: boolean
  latestUpload: { filename: string | null; createdAt: string } | null
  /** Every order / receipt with no bank credit yet, any month — for linking by hand. */
  openOrders: OpenOrder[]
  openReceipts: OpenReceipt[]
  /** Receipt (payment) id → its TM reference, for showing a match. */
  receiptRefs: Record<string, string>
}

type Loaded = { rows: PayproRow[]; credits: Credit[]; ourPaypro: OurPaypro[]; receipts: Receipt[]; links: ManualLink[] }

export async function loadAll(): Promise<Loaded | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const [rowData, creditData, payproData, manualData, linkData] = await Promise.all([
    pageAll((from, to) =>
      admin
        .from('reconciliation_rows')
        .select('id, order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
        .eq('gateway', 'paypro')
        .eq('is_current', true)
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) =>
      admin
        .from('bank_transfers')
        .select('id, transferred_on, transferred_time, amount_pkr, reference, sender_name, sender_bank, note, gateway')
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) =>
      admin.from('payments').select('id, provider_ref, status, amount_pkr, reviewed_at, updated_at, created_at').eq('provider', 'paypro').order('id').range(from, to),
    ),
    pageAll((from, to) =>
      admin
        .from('payments')
        .select('id, provider_ref, amount_pkr, reviewed_at, updated_at, created_at, reference, user_id')
        .eq('provider', 'manual')
        .eq('status', 'approved')
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) => admin.from('settlement_links').select('id, transfer_id, kind, target, note').is('removed_at', null).order('id').range(from, to)),
  ])

  const rows: PayproRow[] = ((rowData ?? []) as Record<string, unknown>[]).map((r) => ({
    orderNumber: String(r.order_number ?? ''),
    transactionStatus: (r.transaction_status as string | null) ?? null,
    paymentVia: (r.payment_via as string | null) ?? null,
    orderAmount: num(r.order_amount),
    merchantShare: num(r.merchant_share),
    datePaid: (r.date_paid as string | null) ?? null,
    settleDate: (r.settle_date as string | null) ?? null,
    settleStatus: (r.settle_status as string | null) ?? null,
  }))

  const credits: Credit[] = ((creditData ?? []) as Record<string, unknown>[]).map((t) => ({
    id: String(t.id),
    date: String(t.transferred_on),
    time: t.transferred_time ? String(t.transferred_time).slice(0, 5) : null,
    amountPkr: num(t.amount_pkr) ?? 0,
    senderName: (t.sender_name as string | null) ?? null,
    senderBank: (t.sender_bank as string | null) ?? null,
    reference: (t.reference as string | null) ?? null,
    note: (t.note as string | null) ?? null,
    isPaypro: String(t.gateway ?? 'paypro') === 'paypro',
  }))

  const ourPaypro: OurPaypro[] = ((payproData ?? []) as Record<string, unknown>[])
    .filter((p) => !!p.provider_ref)
    .map((p) => ({
      ref: String(p.provider_ref),
      status: String(p.status),
      amountPkr: num(p.amount_pkr) ?? 0,
      approvedDay: p.status === 'approved' ? pkDay(String(p.reviewed_at ?? p.updated_at ?? p.created_at)) : null,
    }))

  const manual = (manualData ?? []) as Record<string, unknown>[]
  const names = new Map<string, string>()
  const userIds = [...new Set(manual.map((p) => p.user_id).filter((v): v is string => typeof v === 'string'))]
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', userIds.slice(i, i + 200))
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) names.set(p.id, p.full_name)
  }
  const receipts: Receipt[] = manual.map((p) => ({
    id: String(p.id),
    ref: String(p.provider_ref ?? p.id),
    amountPkr: num(p.amount_pkr) ?? 0,
    approvedDay: pkDay(String(p.reviewed_at ?? p.updated_at ?? p.created_at)),
    transactionId: (p.reference as string | null) ?? null,
    payerName: typeof p.user_id === 'string' ? (names.get(p.user_id) ?? null) : null,
  }))

  const links: ManualLink[] = ((linkData ?? []) as Record<string, unknown>[]).map((l) => ({
    transferId: String(l.transfer_id),
    kind: l.kind as ManualLink['kind'],
    target: (l.target as string | null) ?? null,
    note: (l.note as string | null) ?? null,
  }))

  return { rows, credits, ourPaypro, receipts, links }
}

export async function loadSettlementsBoard(month: string): Promise<SettlementsBoard | null> {
  const admin = createAdminClient()
  const all = await loadAll()
  if (!admin || !all) return null
  const board = buildBoard({ ...all, nowIso: new Date().toISOString() })
  const { data: imp } = await admin
    .from('reconciliation_imports')
    .select('filename, created_at')
    .eq('gateway', 'paypro')
    .order('created_at', { ascending: false })
    .limit(1)
  const latest = ((imp ?? []) as { filename: string | null; created_at: string }[])[0]
  return {
    view: monthView(board, all.ourPaypro, month),
    hasExport: board.hasExport,
    latestUpload: latest ? { filename: latest.filename, createdAt: latest.created_at } : null,
    openOrders: board.orders
      .filter((o) => o.state === 'waiting' || o.state === 'settled_no_credit')
      .map((o) => ({ orderNumber: o.orderNumber, method: o.method, merchantShare: o.merchantShare, settleDate: o.settleDate, datePaid: o.datePaid })),
    openReceipts: board.receipts
      .filter((r) => r.state === 'waiting')
      .map((r) => ({ id: r.id, ref: r.ref, amountPkr: r.amountPkr, approvedDay: r.approvedDay, payerName: r.payerName })),
    receiptRefs: Object.fromEntries(board.receipts.map((r) => [r.id, r.ref])),
  }
}

// ---------------------------------------------------------------------------
// Bank credits
// ---------------------------------------------------------------------------

export type CreditInput = {
  date: string
  time: string | null
  amountPkr: number
  senderName: string | null
  senderBank: string | null
  reference: string
  note: string | null
  /** A PayPro payout (true) or a member's own bank transfer (false). */
  isPaypro: boolean
}

export async function addBankCredit(input: CreditInput, actor: Actor): Promise<{ ok: true; id: string } | { ok: false; error: string; duplicate?: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: NOT_NOW }

  const existing = await pageAll((from, to) => admin.from('bank_transfers').select('id, reference').not('reference', 'is', null).order('id').range(from, to))
  const refs = ((existing ?? []) as { reference: string | null }[]).map((r) => r.reference ?? '')
  const problem = creditProblem(input, refs)
  if (problem) return { ok: false, error: problem, duplicate: /already recorded/.test(problem) }

  const { data, error } = await admin
    .from('bank_transfers')
    .insert({
      transferred_on: input.date,
      transferred_time: input.time,
      amount_pkr: input.amountPkr,
      reference: input.reference.trim().slice(0, 120),
      sender_name: input.senderName?.trim().slice(0, 160) || null,
      sender_bank: input.senderBank?.trim().slice(0, 160) || null,
      note: input.note?.trim().slice(0, 500) || null,
      source: 'manual',
      recorded_by: actor.id,
      gateway: input.isPaypro ? 'paypro' : 'manual',
    })
    .select('id')
    .single()
  if (error || !data) {
    // The unique index is the last word on a duplicate reference.
    if (error?.code === '23505') return { ok: false, error: 'A bank credit with this reference is already recorded. It was not added again.', duplicate: true }
    return { ok: false, error: 'That did not save. Please try again.' }
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.credit_add',
    targetType: 'bank_transfer',
    targetId: data.id,
    detail: { date: input.date, time: input.time, amountPkr: input.amountPkr, reference: input.reference.trim(), senderName: input.senderName, senderBank: input.senderBank, payproPayout: input.isPaypro },
  })
  return { ok: true, id: data.id }
}

export type CreditSaveResult =
  | { reference: string; ok: true; id: string; matched: boolean; match: string }
  | { reference: string; ok: false; duplicate: boolean; error: string }

/**
 * Save several bank credits (a paste of one or more bank alerts), then run the
 * automatic matching and say what each saved credit matched. A credit whose
 * reference is already recorded is skipped, never saved twice; the others are
 * still saved.
 */
export async function addBankCredits(inputs: CreditInput[], actor: Actor): Promise<CreditSaveResult[]> {
  const results: CreditSaveResult[] = []
  for (const input of inputs) {
    const r = await addBankCredit(input, actor)
    results.push(
      r.ok
        ? { reference: input.reference, ok: true, id: r.id, matched: false, match: 'No match yet' }
        : { reference: input.reference, ok: false, duplicate: !!r.duplicate, error: r.error },
    )
  }
  if (results.some((r) => r.ok)) {
    const all = await loadAll()
    if (all) {
      const board = buildBoard({ ...all, nowIso: new Date().toISOString() })
      for (const r of results) {
        if (!r.ok) continue
        const m = matchSummary(board, r.id)
        r.matched = m.matched
        r.match = m.text
      }
    }
  }
  return results
}

/** Which of these references are already recorded as a bank credit. */
export async function recordedReferences(references: string[]): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const existing = await pageAll((from, to) => admin.from('bank_transfers').select('id, reference').not('reference', 'is', null).order('id').range(from, to))
  const have = new Set(((existing ?? []) as { reference: string | null }[]).map((r) => refKey(r.reference)))
  return references.filter((r) => refKey(r) !== '' && have.has(refKey(r)))
}

// ---------------------------------------------------------------------------
// Manual links
// ---------------------------------------------------------------------------

type LinkResult = { ok: true } | { ok: false; error: string }

export async function clearLinks(transferId: string, actor: Actor): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { error } = await admin
    .from('settlement_links')
    .update({ removed_at: new Date().toISOString(), removed_by: actor.id })
    .eq('transfer_id', transferId)
    .is('removed_at', null)
  return !error
}

/**
 * The owner's decision for one bank credit:
 *   link    this credit pays exactly these orders and receipts
 *   unlink  leave this credit unmatched (no automatic match either)
 *   ignore  "Ignore (not a sale)": unlinked, and no longer counted as unmatched.
 *           A credit can never be deleted; this is how a wrong one is set aside.
 *   auto    forget the manual decision and match automatically again
 * Earlier decisions for the credit are kept, marked removed.
 */
export async function setCreditLinks(
  input: { transferId: string; action: 'link' | 'unlink' | 'ignore' | 'auto'; orders?: string[]; receipts?: string[]; note?: string | null },
  actor: Actor,
): Promise<LinkResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: NOT_NOW }
  const note = input.note?.trim().slice(0, 500) || null
  if (input.action !== 'auto' && !note) return { ok: false, error: 'Add a short note saying why.' }

  const { data: transfer } = await admin.from('bank_transfers').select('id, amount_pkr, reference').eq('id', input.transferId).maybeSingle()
  if (!transfer) return { ok: false, error: 'That bank credit was not found.' }

  const orders = [...new Set((input.orders ?? []).map((o) => o.trim()).filter(Boolean))]
  const receipts = [...new Set((input.receipts ?? []).filter(Boolean))]

  if (input.action === 'link') {
    if (orders.length + receipts.length === 0) return { ok: false, error: 'Choose at least one order or bank transfer to link.' }
    const all = await loadAll()
    if (!all) return { ok: false, error: NOT_NOW }
    const known = new Set(all.rows.map((r) => r.orderNumber.trim().toUpperCase()))
    const badOrder = orders.find((o) => !known.has(o.toUpperCase()))
    if (badOrder) return { ok: false, error: `Order ${badOrder} is not in the uploaded PayPro export.` }
    const knownReceipts = new Set(all.receipts.map((r) => r.id))
    if (receipts.some((r) => !knownReceipts.has(r))) return { ok: false, error: 'One of those bank transfers is not an approved receipt.' }
    // An order or receipt can be paid by one credit only.
    const taken = all.links.find(
      (l) =>
        l.transferId !== input.transferId &&
        l.target &&
        ((l.kind === 'order' && orders.some((o) => o.toUpperCase() === l.target!.trim().toUpperCase())) || (l.kind === 'receipt' && receipts.includes(l.target))),
    )
    if (taken) return { ok: false, error: 'One of those is already linked to another bank credit. Unlink it there first.' }
  }

  if (!(await clearLinks(input.transferId, actor))) return { ok: false, error: 'That did not save. Please try again.' }

  if (input.action !== 'auto') {
    const base = { transfer_id: input.transferId, note, linked_by: actor.id, linked_by_email: actor.email ?? null }
    const rows: { transfer_id: string; note: string | null; linked_by: string; linked_by_email: string | null; kind: string; target: string | null }[] =
      input.action === 'unlink'
        ? [{ ...base, kind: 'none', target: null }]
        : input.action === 'ignore'
          ? [{ ...base, kind: 'none', target: NOT_A_SALE }]
        : [...orders.map((o) => ({ ...base, kind: 'order', target: o })), ...receipts.map((r) => ({ ...base, kind: 'receipt', target: r }))]
    const { error } = await admin.from('settlement_links').insert(rows)
    if (error) return { ok: false, error: 'That did not save. Please try again.' }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action:
      input.action === 'link' ? 'settlement.link' : input.action === 'unlink' ? 'settlement.unlink' : input.action === 'ignore' ? 'settlement.ignore' : 'settlement.link_reset',
    targetType: 'bank_transfer',
    targetId: input.transferId,
    detail: { amountPkr: num(transfer.amount_pkr), reference: transfer.reference, orders: input.action === 'link' ? orders : [], receipts: input.action === 'link' ? receipts : [], note },
  })
  return { ok: true }
}
