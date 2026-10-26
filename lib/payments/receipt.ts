// lib/payments/receipt.ts
//
// The server half of the bank-transfer receipt (owner, 11 Oct 2026): where a
// member stands for a package, and the bank panel's details. Rules are in
// receiptCore.ts.

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manualInstructions } from './manual'
import { bankTransferOn, getGatewaySettings } from './gatewaySettings'
import { bankTransferVisible, receiptStateOf, type BankDetails, type ReceiptState } from './receiptCore'

export * from './receiptCore'

/** The member's own bank-transfer state for one package (their own rows, RLS). */
export async function loadReceiptState(userId: string, planCode: string): Promise<ReceiptState> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('payments')
      .select('id, status, provider, screenshot_path, reference, rejection_reason, created_at, updated_at')
      .eq('user_id', userId)
      .eq('plan_code', planCode)
      .eq('provider', 'manual')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return { state: 'none' }
    return receiptStateOf((data ?? []) as Parameters<typeof receiptStateOf>[0])
  } catch {
    return { state: 'none' }
  }
}

/** The bank panel's details, or null when "Other method" must not be offered
 *  (the owner's switch is off, or the details are not filled in). */
export async function loadBankPanel(): Promise<BankDetails | null> {
  const [settings, i] = await Promise.all([getGatewaySettings(), manualInstructions()])
  const details: BankDetails = {
    bankName: i.bankName,
    accountTitle: i.accountTitle,
    accountNumber: i.accountNumber,
    iban: i.iban,
    raastId: i.raastId,
  }
  return bankTransferVisible(bankTransferOn(settings), details) ? details : null
}

/** Sidebar badge: bank-transfer receipts waiting for a decision. */
export async function receiptsWaitingCount(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'manual')
    .eq('status', 'pending')
    .or('screenshot_path.not.is.null,reference.not.is.null')
  return count ?? 0
}
