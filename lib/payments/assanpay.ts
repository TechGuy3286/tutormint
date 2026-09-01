// lib/payments/assanpay.ts
//
// AssanPay adapter. CONFIG-DRIVEN AND NOT YET REACHABLE.
//
// The commercial agreement is still in negotiation (CLAUDE.md, "Packages &
// payments"), so their API documentation is not in hand. Everything that
// depends on their exact field names is marked TODO(assanpay) below; the
// surrounding shape -- create a checkout, redirect, receive a signed webhook,
// activate -- is settled and shared with the simulator, so finishing this is a
// fill-in job rather than a rewrite.
//
// isConfigured() returns false until every ASSANPAY_* variable is present, and
// getProvider() never selects an unconfigured provider. A deploy with half the
// variables set therefore falls back to manual transfer instead of sending a
// member to a checkout that cannot complete.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  CheckoutIntent,
  CheckoutResult,
  PaymentProvider,
  WebhookEvent,
} from './provider'

type Config = {
  baseUrl: string
  merchantId: string
  apiKey: string
  webhookSecret: string
}

function config(): Config | null {
  const baseUrl = process.env.ASSANPAY_BASE_URL
  const merchantId = process.env.ASSANPAY_MERCHANT_ID
  const apiKey = process.env.ASSANPAY_API_KEY
  const webhookSecret = process.env.ASSANPAY_WEBHOOK_SECRET
  if (!baseUrl || !merchantId || !apiKey || !webhookSecret) return null
  return { baseUrl, merchantId, apiKey, webhookSecret }
}

export const assanpay: PaymentProvider = {
  id: 'assanpay',
  label: 'AssanPay',

  isConfigured: () => config() !== null,

  async createCheckout(intent: CheckoutIntent): Promise<CheckoutResult> {
    const cfg = config()
    if (!cfg) throw new Error('AssanPay is not configured.')

    // TODO(assanpay): replace with their documented create-order call.
    //   POST {baseUrl}/{their path}
    //   auth:    apiKey -- header name and scheme per their docs
    //   body:    merchantId, orderId, amount (paisa or rupees?), currency,
    //            description, returnUrl, webhookUrl, customer reference
    //   response: the hosted checkout URL to redirect to.
    // Amount units are the classic integration bug: confirm rupees vs paisa
    // against a test transaction before this goes live.
    const response = await fetch(`${cfg.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        merchant_id: cfg.merchantId,
        order_id: intent.reference,
        amount: intent.amountPkr,
        currency: 'PKR',
        description: `TutorMint ${intent.planName} plan`,
        return_url: `${intent.origin}/pay/return?ref=${encodeURIComponent(intent.reference)}`,
        webhook_url: `${intent.origin}/api/payments/webhook`,
      }),
    })

    if (!response.ok) {
      throw new Error(`AssanPay refused the checkout (${response.status}).`)
    }

    // TODO(assanpay): confirm the field that holds the hosted checkout URL.
    const json = (await response.json()) as { checkout_url?: string; redirect_url?: string }
    const url = json.checkout_url ?? json.redirect_url
    if (!url) throw new Error('AssanPay did not return a checkout URL.')

    return { kind: 'redirect', provider: 'assanpay', url, reference: intent.reference }
  },

  async verifyWebhook(request: Request, rawBody: string): Promise<WebhookEvent | null> {
    const cfg = config()
    if (!cfg) return null

    // TODO(assanpay): confirm the header name and the signed payload. Some
    // gateways sign the raw body, others a canonical field concatenation; the
    // two are not interchangeable and getting it wrong means either rejecting
    // every real callback or accepting forged ones.
    const provided = request.headers.get('x-assanpay-signature')
    if (!provided) return null

    const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(provided, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return null
    }

    // TODO(assanpay): map their status vocabulary. Anything not explicitly a
    // success is treated as a failure, which is the safe direction: a missed
    // success is a support ticket, a wrong success is a free plan.
    const reference = String(payload.order_id ?? payload.orderId ?? '')
    if (!reference) return null

    const status = String(payload.status ?? '').toLowerCase()
    const outcome: 'success' | 'failed' =
      status === 'paid' || status === 'success' || status === 'completed' ? 'success' : 'failed'

    const amount = Number(payload.amount)

    return {
      provider: 'assanpay',
      reference,
      outcome,
      amountPkr: Number.isFinite(amount) ? amount : null,
      raw: payload,
    }
  },
}
