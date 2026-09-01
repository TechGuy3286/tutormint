// lib/payments/simulator.ts
//
// A fake gateway, so the real purchase path can be exercised today.
//
// It is not a mock inside the tests: it is a provider like any other. A
// simulated purchase goes through the same checkout route, redirects to a
// hosted page (ours), and comes back as an HMAC-signed webhook to the same
// /api/payments/webhook that AssanPay will call. Everything downstream --
// signature verification, idempotency, activation, badges, quota -- is the
// code that will run in production.
//
// THREE locks, all of which must be open:
//   NODE_ENV !== 'production'
//   PAYMENTS_SIMULATOR === 'true'
//   PAYMENTS_SIMULATOR_SECRET is set
// The last one matters: without a secret the webhook could not be signed, and
// a signature check that can be satisfied by omitting the secret is not a
// check. There is no default value anywhere in this file.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  CheckoutIntent,
  CheckoutResult,
  PaymentProvider,
  WebhookEvent,
} from './provider'
import { simulatorEnabled } from './provider'

export const SIMULATOR_SIGNATURE_HEADER = 'x-tutormint-signature'

export function signSimulatorPayload(rawBody: string): string {
  const secret = process.env.PAYMENTS_SIMULATOR_SECRET
  if (!secret) throw new Error('PAYMENTS_SIMULATOR_SECRET is not set.')
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export const simulator: PaymentProvider = {
  id: 'simulator',
  label: 'Test gateway (development only)',

  isConfigured: simulatorEnabled,

  async createCheckout(intent: CheckoutIntent): Promise<CheckoutResult> {
    if (!simulatorEnabled()) throw new Error('The payment simulator is not enabled.')
    return {
      kind: 'redirect',
      provider: 'simulator',
      url: `${intent.origin}/pay/simulator/${encodeURIComponent(intent.reference)}`,
      reference: intent.reference,
    }
  },

  async verifyWebhook(request: Request, rawBody: string): Promise<WebhookEvent | null> {
    if (!simulatorEnabled()) return null

    const provided = request.headers.get(SIMULATOR_SIGNATURE_HEADER)
    if (!provided) return null

    const expected = signSimulatorPayload(rawBody)
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(provided, 'utf8')
    // Length check first: timingSafeEqual throws on a mismatch, and a thrown
    // error inside a signature check is a 500 where a 401 belongs.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    let payload: { reference?: string; outcome?: string; amountPkr?: number }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return null
    }

    if (!payload.reference) return null

    return {
      provider: 'simulator',
      reference: payload.reference,
      outcome: payload.outcome === 'success' ? 'success' : 'failed',
      amountPkr: typeof payload.amountPkr === 'number' ? payload.amountPkr : null,
      raw: payload as Record<string, unknown>,
    }
  },
}
