// lib/payments/index.ts
//
// Which provider is live, and how an inbound webhook is matched to one.

import { assanpay } from './assanpay'
import { manual } from './manual'
import { simulator } from './simulator'
import type { PaymentProvider, WebhookEvent } from './provider'

export * from './provider'
export { assanpay, manual, simulator }

/**
 * The provider a new purchase goes through.
 *
 * Order is deliberate. The simulator can only be configured outside
 * production, so it winning there is safe and makes local testing the default.
 * AssanPay takes over the moment its variables exist. Manual transfer is the
 * floor: it needs no integration, so there is always something to sell
 * through, and it never silently pretends to be instant.
 */
export function getProvider(): PaymentProvider {
  if (simulator.isConfigured()) return simulator
  if (assanpay.isConfigured()) return assanpay
  return manual
}

/**
 * Verify a webhook against every provider that could have sent one.
 *
 * Each verifier returns null when the request is not its own, so an
 * unsigned or wrongly-signed request matches nothing and the route answers
 * 401. Manual is not consulted -- a bank transfer has no webhook, and adding
 * one would be a way to activate a plan without a signature.
 */
export async function verifyInboundWebhook(
  request: Request,
  rawBody: string,
): Promise<WebhookEvent | null> {
  for (const p of [simulator, assanpay]) {
    if (!p.isConfigured()) continue
    const event = await p.verifyWebhook(request, rawBody)
    if (event) return event
  }
  return null
}
