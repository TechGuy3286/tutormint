// lib/payproExport.ts
//
// Read PayPro's Orders export — the .xlsx their portal downloads, or the same
// report saved as .csv — into the eight columns the settlement check keeps
// (owner, 11 Oct 2026). No database and no server-only import, so the importer,
// the local report script and the tests all read a file the same way.
//
// The real export has 22 columns and a second sheet ("Bill Detail 01"). This
// reader takes the sheet named "Orders" (any case), else the first sheet with
// an "Order-Number" header; finds the header in the first ten rows; and maps
// the eight columns by name. Customer-Name, Customer-Mobile, Customer-Email,
// Customer-Address and Customer-Bank are never mapped, so they are never
// returned, stored or shown.
//
// Dates are calendar days as PayPro writes them (Pakistan time): a text date
// like "02-Oct-2026" and a real Excel date both come back as that same day,
// with no time-zone shift.

import {
  missingPayproColumns,
  parseCsvTable,
  rowsFromSheet,
  type PayproRow,
  type SheetCell,
} from './reconciliationCore'
import { readXlsxSheets } from './xlsxRead'

export type PayproExport = { ok: true; sheet: string | null; rows: PayproRow[] } | { ok: false; error: string }

const NOT_READ = 'We could not read that file. Upload the PayPro Orders export as .xlsx or .csv.'

/** PayPro writes "EasyPaisa"; we call it Easypaisa everywhere. */
export function normalisePaymentVia(via: string | null): string | null {
  if (via === null) return null
  const s = via.trim()
  if (/^easy\s?paisa$/i.test(s)) return 'Easypaisa'
  if (/^jazz\s?cash$/i.test(s)) return 'JazzCash'
  return s === '' ? null : s
}

function fromTable(cells: SheetCell[][], sheet: string | null): PayproExport {
  const missing = missingPayproColumns(cells)
  if (missing.length > 0) return { ok: false, error: `Missing column: ${missing.join(', ')}. Upload the PayPro Orders export without removing columns.` }
  const rows = rowsFromSheet(cells).map((r) => ({ ...r, paymentVia: normalisePaymentVia(r.paymentVia) }))
  if (rows.length === 0) return { ok: false, error: 'That file has the right columns but no orders in it.' }
  return { ok: true, sheet, rows }
}

export async function readPayproExport(buffer: Buffer | Uint8Array, filename: string): Promise<PayproExport> {
  const lower = filename.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm')) {
    try {
      return fromTable(parseCsvTable(Buffer.from(buffer).toString('utf8')), null)
    } catch {
      return { ok: false, error: NOT_READ }
    }
  }

  let sheets
  try {
    sheets = await readXlsxSheets(buffer)
  } catch {
    return { ok: false, error: NOT_READ }
  }
  const hasHeader = (rows: SheetCell[][]) => !missingPayproColumns(rows).includes('Order-Number')
  const named = sheets.find((s) => s.name.trim().toLowerCase() === 'orders')
  const pick = (named && hasHeader(named.rows) ? named : undefined) ?? sheets.find((s) => hasHeader(s.rows)) ?? named ?? sheets[0]
  return fromTable(pick.rows, pick.name || null)
}
