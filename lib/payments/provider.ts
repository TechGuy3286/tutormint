// lib/payments/provider.ts
//
// The payment provider contract.
//
// TutorMint sells exactly one thing -- a 30-day plan -- and it will be sold
// through AssanPay once that integration is signed off. Until then the same
// flow has to be exercisable, so payment handling is written against this
// interface and the concrete provider is chosen at runtime:
//
//   simulator  non-production only, and only with PAYMENTS_SIMULATOR=true.
//              Renders a fake gateway and posts a signed webhook back to us,
//              so the whole purchase -> webhook -> activation path is real
//              code with a fake bank at the end of it.
//   assanpay   the real gateway. Unreachable until the ASSANPAY_* env vars
//              exist, so a half-configured deploy cannot take money.
//   manual     the fallback: bank / JazzCash / Easypaisa transfer with a
//              reference and a screenshot, approved by a finance admin.
//
// The rule that matters: nothing in this module activates a plan. Activation
// lives in lib/payments/activate.ts and is reached from exactly two places --
// a verified webhook, and an audited admin approval.

import { isProduction } from '@/lib/env'

export type ProviderId = 'assanpay' | 'manual' | 'simulator'

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
  iban: string | null
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

/**
 * Is the fake gateway available?
 *
 * Three conditions, all required. The environment check is isProduction() from
 * lib/env.ts rather than NODE_ENV: a Vercel preview is a `next build`, so
 * NODE_ENV reads 'production' there and the simulator would refuse on the one
 * deployment somebody actually wants to test a purchase on — with a live card
 * gateway as the only alternative.
 *
 * On tutormint.org VERCEL_ENV is 'production' and this returns false, whatever
 * PAYMENTS_SIMULATOR says.
 */
export function simulatorEnabled(): boolean {
  return (
    !isProduction() &&
    process.env.PAYMENTS_SIMULATOR === 'true' &&
    !!process.env.PAYMENTS_SIMULATOR_SECRET
  )
}
