// lib/payments/gatewaySettingsCore.ts
//
// Payment gateways (owner, 6 Oct 2026, item 19) — the PURE half: the settings
// shape, how they are read from app_settings rows, and the rules a change must
// obey. No I/O, so it runs in the route, the page, checkout and the tests.
//
// What our integration can actually control, stated plainly:
//   • PayPro's own page offers JazzCash, Easypaisa and card TOGETHER. Its API
//     (docs/paypro/…postman_collection.json, create order /v2/ppro/co) has no
//     field to show or hide one of them, so they switch on and off as ONE
//     method: "Online payment on PayPro".
//   • Bank transfer is our own order page (/pay/manual) — fully ours.
//   • "Pay later" is a separate link, not a payment method.
//   • Who pays PayPro's service fee is set in the PayPro account; the API only
//     reports it back (IsFeeApplied). There is nothing to toggle here.

export type GatewayId = 'paypro' | 'assanpay'

export const GATEWAYS: { id: GatewayId; name: string }[] = [
  { id: 'paypro', name: 'PayPro' },
  { id: 'assanpay', name: 'AssanPay' },
]

export type MethodKey = 'paypro_online' | 'bank_transfer'

export type GatewaySettings = {
  active: GatewayId
  methods: Record<MethodKey, boolean>
  payLater: boolean
}

export const GATEWAY_KEYS = {
  active: 'pay.gateway.active',
  paypro_online: 'pay.method.paypro_online',
  bank_transfer: 'pay.method.bank_transfer',
  payLater: 'pay.pay_later',
} as const

/** Today's state (owner, 6 Oct 2026): PayPro on, bank transfer and Pay later
 *  off. Also the value used when the settings cannot be read. */
export const DEFAULT_GATEWAY_SETTINGS: GatewaySettings = {
  active: 'paypro',
  methods: { paypro_online: true, bank_transfer: false },
  payLater: false,
}

export function parseGatewaySettings(rows: { key: string; value: string | null }[]): GatewaySettings {
  const m = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]))
  const bool = (key: string, fallback: boolean) => {
    const v = m.get(key)
    return v === 'true' ? true : v === 'false' ? false : fallback
  }
  const active = m.get(GATEWAY_KEYS.active)
  return {
    active: active === 'assanpay' ? 'assanpay' : 'paypro',
    methods: {
      paypro_online: bool(GATEWAY_KEYS.paypro_online, DEFAULT_GATEWAY_SETTINGS.methods.paypro_online),
      bank_transfer: bool(GATEWAY_KEYS.bank_transfer, DEFAULT_GATEWAY_SETTINGS.methods.bank_transfer),
    },
    payLater: bool(GATEWAY_KEYS.payLater, DEFAULT_GATEWAY_SETTINGS.payLater),
  }
}

/** Which methods each gateway supports on our side. AssanPay is not built. */
export function methodsFor(gateway: GatewayId): MethodKey[] {
  return gateway === 'paypro' ? ['paypro_online', 'bank_transfer'] : ['bank_transfer']
}

/** A method change is refused when it would leave no method on. */
export function methodChangeError(current: GatewaySettings, method: MethodKey, on: boolean): string | null {
  if (on) return null
  const next = { ...current.methods, [method]: false }
  const anyOn = methodsFor(current.active).some((k) => next[k])
  return anyOn ? null : 'At least one payment method must stay on.'
}

/** A gateway can be made active only when it is configured. */
export function activeChangeError(target: GatewayId, configured: Record<GatewayId, boolean>): string | null {
  if (!configured[target]) {
    const name = GATEWAYS.find((g) => g.id === target)?.name ?? target
    return `${name} is not configured yet, so it cannot be made active.`
  }
  return null
}

/**
 * PayPro is RETIRED (owner, 26 Oct 2026). Payments are Faysal Bank transfer only
 * (Raast / IBFT + a receipt). No setting can turn PayPro checkout back on: a new
 * PayPro order is refused everywhere, and bank transfer is always offered. The
 * PayPro listener still confirms orders started before the change until the
 * cut-off in lib/payments/payproRetireCore.ts. Our own JazzCash / Easypaisa
 * gateways come later, in their own change.
 */
export const PAYPRO_RETIRED = true

/** Online (PayPro) checkout. Always false while PAYPRO_RETIRED. */
export function onlineCheckoutOn(s: GatewaySettings): boolean {
  if (PAYPRO_RETIRED) return false
  return s.active === 'paypro' && s.methods.paypro_online
}

/** Bank transfer is the one way to pay, so it is always on while PayPro is retired. */
export function bankTransferOn(s: GatewaySettings): boolean {
  if (PAYPRO_RETIRED) return true
  return s.methods.bank_transfer
}

/** What a checkout screen may offer, derived from the settings. Client-safe. */
export type CheckoutMethods = { online: boolean; bankTransfer: boolean; payLater: boolean }

export const DEFAULT_CHECKOUT_METHODS: CheckoutMethods = { online: false, bankTransfer: true, payLater: false }

export function checkoutMethodsOf(s: GatewaySettings): CheckoutMethods {
  return { online: onlineCheckoutOn(s), bankTransfer: bankTransferOn(s), payLater: s.payLater }
}
