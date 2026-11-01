// lib/payments/index.ts
//
// Which provider a new purchase goes through.
//
// Since 31 Oct 2026 there is only one: manual bank transfer (the PayPro card
// checkout was retired on 26 Oct and its own routes — /paypro/uis and the
// 5-minute re-check — run until the cut-off). The never-live AssanPay adapter
// and the non-production payment simulator were removed, with their routes
// (/pay/simulator, /api/payments/simulate) and the generic gateway webhook.

import { manual } from './manual'
import type { PaymentProvider } from './provider'

export * from './provider'
export { manual }

export function getProvider(): PaymentProvider {
  return manual
}

/** Is a card gateway live? No: members pay by bank transfer. */
export function paymentsGatewayLive(): boolean {
  return false
}
