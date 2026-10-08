// lib/reconciliation.ts
//
// PayPro reconciliation — the I/O half. Reads the PayPro export (xlsx via
// exceljs, csv via the core parser), stores the eight columns we keep, loads
// our own `payments` rows and the bank transfers, and hands everything to the
// pure core (lib/reconciliationCore.ts) for matching and sums.
//
// Every write goes through the service role (the three tables carry an
// admin-READ policy and no write policy) and writes an admin_audit_log row.
// Nothing here ever changes a payment's status — that stays with the payments
// queue and its own audited approve/reject.

import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { Workbook, type CellValue } from 'exceljs'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import {
  matchRows,
  parseBankCsv,
  parsePayproCsv,
  rowsFromSheet,
  summarise,
  type MatchResult,
  type PaymentRef,
  type PayproRow,
  type Period,
  type SheetCell,
  type Summary,
  type Transfer,
} from '@/lib/reconciliationCore'

export type Actor = { id: string; adminRole: AdminRole; email?: string | null }

export type ImportSummary = {
  id: string
  filename: string | null
  sheet: string | null
  rowCount: number
  periodFrom: string | null
  periodTo: string | null
  createdAt: string
}

export type TransferRow = Transfer & { id: string; source: 'manual' | 'csv'; createdAt: string }

export type ReconciliationView = {
  period: { from: string; to: string }
  latestImport: ImportSummary | null
  rowCount: number
  paymentCount: number
  matches: MatchResult
  summary: Summary
  transfers: TransferRow[]
}

const MAX_ROWS = 20000

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** exceljs cell → the plain value the core understands. */
function plainCell(v: CellValue): SheetCell {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return plainCell(v.result as CellValue)
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('text' in v && v.text && typeof v.text === 'object' && 'richText' in v.text) {
      return (v.text as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
    }
    if ('error' in v) return null
  }
  return String(v)
}

async function readXlsx(buffer: Buffer): Promise<{ sheet: string; rows: PayproRow[] }> {
  const wb = new Workbook()
  // exceljs declares its own Buffer type; a Node Buffer satisfies it at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const ws = wb.getWorksheet('Orders') ?? wb.worksheets[0]
  if (!ws) return { sheet: '', rows: [] }

  const cells: SheetCell[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed (index 0 is always empty).
    const values = (row.values as CellValue[]).slice(1)
    cells.push(values.map(plainCell))
  })
  return { sheet: ws.name, rows: rowsFromSheet(cells) }
}

export type ImportResult =
  | { ok: true; importId: string; rowCount: number; sheet: string | null }
  | { ok: false; error: string }

/**
 * Store a PayPro Orders export. Only the eight mapped columns are kept; the
 * export's customer name / mobile / email columns are never read past the
 * parser. Returns a plain error when the file has no recognisable header.
 */
export async function importPayproFile(
  buffer: Buffer,
  filename: string,
  actor: Actor,
  gateway = 'paypro',
): Promise<ImportResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'The server is not configured for admin writes.' }

  const lower = filename.toLowerCase()
  let sheet: string | null = null
  let rows: PayproRow[]
  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      const read = await readXlsx(buffer)
      sheet = read.sheet || null
      rows = read.rows
    } else {
      rows = parsePayproCsv(buffer.toString('utf8'))
    }
  } catch {
    return { ok: false, error: 'We could not read that file. Upload the PayPro Orders export as .xlsx or .csv.' }
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error:
        'No orders were found. The file needs the PayPro columns Order-Number, Transaction Status, Order-Amount, MerchantShare, Date Paid.',
    }
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `That file has more than ${MAX_ROWS.toLocaleString('en-PK')} orders. Export one month at a time.` }
  }

  const dates = rows.map((r) => r.datePaid).filter((d): d is string => !!d).sort()
  const periodFrom = dates[0] ?? null
  const periodTo = dates[dates.length - 1] ?? null

  const { data: imp, error: impErr } = await admin
    .from('reconciliation_imports')
    .insert({
      filename: filename.slice(0, 200),
      sheet,
      row_count: rows.length,
      period_from: periodFrom,
      period_to: periodTo,
      uploaded_by: actor.id,
      gateway,
    })
    .select('id')
    .single()
  if (impErr || !imp) return { ok: false, error: 'Could not save the import. Please try again.' }

  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({
      import_id: imp.id,
      order_number: r.orderNumber.slice(0, 120),
      transaction_status: r.transactionStatus,
      payment_via: r.paymentVia,
      order_amount: r.orderAmount,
      merchant_share: r.merchantShare,
      date_paid: r.datePaid,
      settle_date: r.settleDate,
      settle_status: r.settleStatus,
    }))
    const { error } = await admin.from('reconciliation_rows').insert(slice)
    if (error) {
      // Half an import is worse than none: remove the header row (cascades).
      await admin.from('reconciliation_imports').delete().eq('id', imp.id)
      return { ok: false, error: 'Could not save the orders. Nothing was kept — please try again.' }
    }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'reconciliation.import',
    targetType: 'reconciliation_import',
    targetId: imp.id,
    detail: { filename: filename.slice(0, 200), sheet, rowCount: rows.length, periodFrom, periodTo },
  })

  return { ok: true, importId: imp.id, rowCount: rows.length, sheet }
}

// ---------------------------------------------------------------------------
// Reading everything back
// ---------------------------------------------------------------------------

type ImportRecord = {
  id: string
  filename: string | null
  sheet: string | null
  row_count: number | null
  period_from: string | null
  period_to: string | null
  created_at: string
}

type RowRecord = {
  order_number: string
  transaction_status: string | null
  payment_via: string | null
  order_amount: number | string | null
  merchant_share: number | string | null
  date_paid: string | null
  settle_date: string | null
  settle_status: string | null
}

type TransferRecord = {
  id: string
  transferred_on: string
  amount_pkr: number | string
  reference: string | null
  account_last4: string | null
  source: 'manual' | 'csv'
  created_at: string
}

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadTransfers(): Promise<TransferRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const data = await pageAll((from, to) =>
    admin
      .from('bank_transfers')
      .select('id, transferred_on, amount_pkr, reference, account_last4, source, created_at')
      .order('transferred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  return ((data ?? []) as TransferRecord[]).map((t) => ({
    id: t.id,
    transferredOn: t.transferred_on,
    amountPkr: num(t.amount_pkr) ?? 0,
    reference: t.reference,
    accountLast4: t.account_last4,
    source: t.source,
    createdAt: t.created_at,
  }))
}

export async function loadReconciliation(period: { from: string; to: string }): Promise<ReconciliationView | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const { data: imports } = await admin
    .from('reconciliation_imports')
    .select('id, filename, sheet, row_count, period_from, period_to, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
  const latest = ((imports ?? []) as ImportRecord[])[0] ?? null

  let rows: PayproRow[] = []
  if (latest) {
    const data = await pageAll((from, to) =>
      admin
        .from('reconciliation_rows')
        .select('id, order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
        .eq('import_id', latest.id)
        .order('id')
        .range(from, to),
      MAX_ROWS,
    )
    rows = ((data ?? []) as RowRecord[]).map((r) => ({
      orderNumber: r.order_number,
      transactionStatus: r.transaction_status,
      paymentVia: r.payment_via,
      orderAmount: num(r.order_amount),
      merchantShare: num(r.merchant_share),
      datePaid: r.date_paid,
      settleDate: r.settle_date,
      settleStatus: r.settle_status,
    }))
  }

  // Our side: every PayPro payment. Only the three columns the comparison needs.
  const payData = await pageAll((from, to) =>
    admin.from('payments').select('id, provider_ref, status, amount_pkr, created_at').eq('provider', 'paypro').order('created_at', { ascending: false }).order('id').range(from, to),
    MAX_ROWS,
  )
  const payments: PaymentRef[] = ((payData ?? []) as { provider_ref: string | null; status: string; amount_pkr: number | string | null }[])
    .filter((p) => !!p.provider_ref)
    .map((p) => ({ providerRef: p.provider_ref as string, status: p.status, amountPkr: num(p.amount_pkr) }))

  const transfers = await loadTransfers()
  const p: Period = { from: period.from, to: period.to }

  return {
    period,
    latestImport: latest
      ? {
          id: latest.id,
          filename: latest.filename,
          sheet: latest.sheet,
          rowCount: latest.row_count ?? rows.length,
          periodFrom: latest.period_from,
          periodTo: latest.period_to,
          createdAt: latest.created_at,
        }
      : null,
    rowCount: rows.length,
    paymentCount: payments.length,
    matches: matchRows(rows, payments),
    summary: summarise(rows, transfers, p),
    transfers,
  }
}

// ---------------------------------------------------------------------------
// Bank transfers
// ---------------------------------------------------------------------------

export async function recordTransfer(
  input: { transferredOn: string; amountPkr: number; reference: string | null; accountLast4: string | null },
  actor: Actor,
  gateway = 'paypro',
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'The server is not configured for admin writes.' }

  const { data, error } = await admin
    .from('bank_transfers')
    .insert({
      transferred_on: input.transferredOn,
      amount_pkr: input.amountPkr,
      reference: input.reference,
      account_last4: input.accountLast4,
      source: 'manual',
      recorded_by: actor.id,
      gateway,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: 'Could not record the transfer. Please try again.' }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'reconciliation.transfer',
    targetType: 'bank_transfer',
    targetId: data.id,
    detail: { transferredOn: input.transferredOn, amountPkr: input.amountPkr, accountLast4: input.accountLast4 },
  })
  return { ok: true, id: data.id }
}

/**
 * Import a bank statement CSV. A line identical to one already imported from a
 * statement (same day, amount and reference) is skipped, so uploading the same
 * statement twice does not double the money received.
 */
export async function importBankCsv(
  text: string,
  filename: string,
  actor: Actor,
  gateway = 'paypro',
): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'The server is not configured for admin writes.' }

  let transfers: Transfer[]
  try {
    transfers = parseBankCsv(text)
  } catch {
    return { ok: false, error: 'We could not read that statement. Upload it as a CSV.' }
  }
  if (transfers.length === 0) {
    return { ok: false, error: 'No credits were found. The CSV needs a date column and an amount (or credit) column.' }
  }

  const days = transfers.map((t) => t.transferredOn).sort()
  const existing = await pageAll((from, to) =>
    admin
      .from('bank_transfers')
      .select('id, transferred_on, amount_pkr, reference')
      .eq('source', 'csv')
      .eq('gateway', gateway)
      .gte('transferred_on', days[0])
      .lte('transferred_on', days[days.length - 1])
      .order('id')
      .range(from, to),
  )
  const seen = new Set(
    ((existing ?? []) as { transferred_on: string; amount_pkr: number | string; reference: string | null }[]).map(
      (e) => `${e.transferred_on}|${num(e.amount_pkr)}|${(e.reference ?? '').trim()}`,
    ),
  )

  const fresh = transfers.filter((t) => {
    const k = `${t.transferredOn}|${t.amountPkr}|${(t.reference ?? '').trim()}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const skipped = transfers.length - fresh.length

  if (fresh.length > 0) {
    const { error } = await admin.from('bank_transfers').insert(
      fresh.map((t) => ({
        transferred_on: t.transferredOn,
        amount_pkr: t.amountPkr,
        reference: t.reference ? t.reference.slice(0, 300) : null,
        account_last4: t.accountLast4,
        source: 'csv',
        recorded_by: actor.id,
        gateway,
      })),
    )
    if (error) return { ok: false, error: 'Could not save the statement rows. Please try again.' }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'reconciliation.bank_import',
    targetType: 'bank_transfers',
    targetId: filename.slice(0, 200),
    detail: { filename: filename.slice(0, 200), added: fresh.length, skipped },
  })

  return { ok: true, added: fresh.length, skipped }
}
