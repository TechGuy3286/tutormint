// lib/payments/bankCopyCore.ts — PURE. The copyable bank details on the payment
// page (owner, 26 Oct 2026): which rows show, in what order, how a number is
// shown (groups of 4 for reading) and what is copied (no spaces), and the one
// "Copy all details" message, tidy enough to paste into WhatsApp.

import type { BankDetails } from './receiptCore'

export type BankCopyRow = {
  key: 'accountTitle' | 'bankName' | 'accountNumber' | 'iban' | 'raastId' | 'amount'
  label: string
  /** As shown on screen. */
  display: string
  /** As copied: numbers without spaces. */
  copy: string
  /** Has a Copy button on the payment page — the account number and IBAN only
   *  (owner, 26 Oct 2026). */
  copyable: boolean
}

/** The rows that carry a Copy button. */
export const COPYABLE_KEYS: readonly BankCopyRow['key'][] = ['accountNumber', 'iban']

/** The bank's name shown when none is stored. */
export const DEFAULT_BANK_NAME = 'Faysal Bank'

/** Every space, dash or other separator out of an account number / IBAN. */
export function compactNumber(value: string): string {
  return value.replace(/[\s\-–—_.]/g, '').toUpperCase()
}

/** "PK36SCBL0000001123456702" → "PK36 SCBL 0000 0011 2345 6702". */
export function groupsOf4(value: string): string {
  const c = compactNumber(value)
  return c.replace(/(.{4})(?=.)/g, '$1 ')
}

const has = (v: string | null | undefined): v is string => !!v && v.trim().length > 0

/** The rows, in the owner's order: Account title, Bank, Account number, IBAN,
 *  Raast ID (only when set), then the amount when given. */
export function bankCopyRows(d: BankDetails, amount?: string | null): BankCopyRow[] {
  const rows: Omit<BankCopyRow, 'copyable'>[] = []
  if (has(d.accountTitle)) rows.push({ key: 'accountTitle', label: 'Account title', display: d.accountTitle.trim(), copy: d.accountTitle.trim() })
  rows.push({ key: 'bankName', label: 'Bank', display: has(d.bankName) ? d.bankName.trim() : DEFAULT_BANK_NAME, copy: has(d.bankName) ? d.bankName.trim() : DEFAULT_BANK_NAME })
  if (has(d.accountNumber)) rows.push({ key: 'accountNumber', label: 'Account number', display: groupsOf4(d.accountNumber), copy: compactNumber(d.accountNumber) })
  if (has(d.iban)) rows.push({ key: 'iban', label: 'IBAN', display: groupsOf4(d.iban), copy: compactNumber(d.iban) })
  if (has(d.raastId)) rows.push({ key: 'raastId', label: 'Raast ID', display: groupsOf4(d.raastId), copy: compactNumber(d.raastId) })
  if (has(amount)) rows.push({ key: 'amount', label: 'Amount', display: amount.trim(), copy: amount.trim() })
  return rows.map((r) => ({ ...r, copyable: COPYABLE_KEYS.includes(r.key) }))
}

/** One message with every detail, numbers without spaces. */
export function copyAllText(d: BankDetails, amount?: string | null): string {
  const lines = ['TutorMint bank transfer details']
  for (const r of bankCopyRows(d, amount)) lines.push(`${r.label}: ${r.copy}`)
  return lines.join('\n')
}

/** How long "Copied ✓" stays on a button. */
export const COPIED_MS = 2000
