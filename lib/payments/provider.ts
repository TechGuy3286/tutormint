// lib/payments/provider.ts
//
// The payment provider contract.
//
// Since 31 Oct 2026 the one provider is manual bank transfer (lib/payments/index).
// The never-live AssanPay adapter and the non-production simulator were removed.
//
// The rule that matters: nothing in this module activates a plan. Activation
// lives in lib/payments/activate.ts.

export type ProviderId = 'manual'

/** What we are asking the provider to collect. */
export type CheckoutIntent = {
  paymentId: string
  /** Our order reference. Unique per payment; the webhook is matched on it. */
  reference: string
  planCode: string
  planName: string
  amountPkr: number
  userId: string
  /** Origin of the request, so return/callback URLs work in dev and prod. */
  origin: string
}

export type ManualInstructions = {
  bankName: string | null
  accountTitle: string | null
  /** Branch name/code of the bank account (PR98 §4). */
  bankBranch: string | null
  /** The plain account number (PR98 §4), shown alongside the IBAN. */
  accountNumber: string | null
  iban: string | null
  /** Optional Raast ID; null = not shown. */
  raastId: string | null
  /** Storage path of an optional QR image in the private payment-proofs bucket;
   *  null hides the QR block. Served only through /api/payments/bank-qr. */
  qrPath: string | null
  jazzcash: string | null
  easypaisa: string | null
}

export type CheckoutResult =
  /** Send the member to `url`; the provider calls our webhook when done. */
  | { kind: 'redirect'; provider: ProviderId; url: string; reference: string }
  /** No gateway: show transfer instructions and collect a reference. */
  | { kind: 'manual'; provider: 'manual'; reference: string }

/** A webhook we have verified came from the provider and not from a stranger. */
export type WebhookEvent = {
  provider: ProviderId
  reference: string
  outcome: 'success' | 'failed'
  /** What the provider says was paid, for comparison against the plan price. */
  amountPkr: number | null
  raw: Record<string, unknown>
}

export interface PaymentProvider {
  readonly id: ProviderId
  readonly label: string
  /** False when its env vars are missing. A provider that is not configured is never selected. */
  isConfigured(): boolean
  createCheckout(intent: CheckoutIntent): Promise<CheckoutResult>
  /**
   * Verify and parse an inbound webhook.
   * Returns null when the request is not ours or the signature does not check
   * out. Callers answer 401 -- never "ignored", which would hide an attack.
   */
  verifyWebhook(request: Request, rawBody: string): Promise<WebhookEvent | null>
}

/** Our order reference. Prefixed so it is recognisable in a bank statement. */
export function newPaymentReference(): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `TM-${Date.now().toString(36).toUpperCase()}-${rand.toUpperCase()}`
}
