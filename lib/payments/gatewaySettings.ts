// lib/payments/gatewaySettings.ts
//
// Payment gateways (owner, 6 Oct 2026, item 19) — the server half: read the
// settings from app_settings, record a gateway event (a callback received or an
// error hit), and compute each gateway's health for the admin screen. The rules
// live in gatewaySettingsCore.ts.
//
// Credentials are never read into, shown on or stored by this screen: whether a
// gateway is "connected" is only whether its environment variables are present.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { pproConfigured } from './paypro'
import { assanpay } from './assanpay'
import {
  DEFAULT_GATEWAY_SETTINGS,
  GATEWAY_KEYS,
  parseGatewaySettings,
  type GatewayId,
  type GatewaySettings,
} from './gatewaySettingsCore'

export * from './gatewaySettingsCore'

/** The current settings. A read failure gives today's state (PayPro on, bank
 *  transfer and Pay later off), never a wider one. */
export async function getGatewaySettings(): Promise<GatewaySettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', Object.values(GATEWAY_KEYS))
    if (error) return DEFAULT_GATEWAY_SETTINGS
    return parseGatewaySettings((data ?? []) as { key: string; value: string | null }[])
  } catch {
    return DEFAULT_GATEWAY_SETTINGS
  }
}

export function gatewayConfigured(): Record<GatewayId, boolean> {
  return { paypro: pproConfigured(), assanpay: assanpay.isConfigured() }
}

/** Record a callback received or an error hit. `message` must be plain English
 *  with no credential, token or customer detail in it. Never throws. */
export async function recordGatewayEvent(gateway: GatewayId, kind: 'callback' | 'error', message: string | null = null): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    await admin.from('gateway_events').insert({ gateway, kind, message: message ? message.slice(0, 300) : null })
  } catch {
    /* health is a convenience — a failed write must never break a payment */
  }
}

export type GatewayHealth = {
  id: GatewayId
  name: string
  connected: boolean
  lastSuccessAt: string | null
  lastError: { at: string; message: string } | null
  lastCallbackAt: string | null
  pendingOverHour: number
}

/** Who pays PayPro's service fee, as PayPro last reported it on an order. */
export type FeeInfo = { lastReported: string | null; lastOrderAt: string | null }

export async function loadGatewayHealth(): Promise<{ gateways: GatewayHealth[]; fee: FeeInfo }> {
  const admin = createAdminClient()
  const configured = gatewayConfigured()
  const empty = (id: GatewayId, name: string): GatewayHealth => ({
    id, name, connected: configured[id], lastSuccessAt: null, lastError: null, lastCallbackAt: null, pendingOverHour: 0,
  })
  if (!admin) return { gateways: [empty('paypro', 'PayPro'), empty('assanpay', 'AssanPay')], fee: { lastReported: null, lastOrderAt: null } }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const one = async (id: GatewayId, name: string): Promise<GatewayHealth> => {
    const [ok, err, cb, pend, rejected] = await Promise.all([
      admin.from('payments').select('reviewed_at, updated_at, created_at').eq('provider', id).eq('status', 'approved')
        .order('updated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      admin.from('gateway_events').select('message, created_at').eq('gateway', id).eq('kind', 'error')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('gateway_events').select('created_at').eq('gateway', id).eq('kind', 'callback')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('payments').select('id', { count: 'exact', head: true }).eq('provider', id).eq('status', 'pending').lt('created_at', hourAgo),
      admin.from('payments').select('updated_at').eq('provider', id).eq('status', 'rejected')
        .neq('rejection_reason', 'Expired checkout — replaced by a new order.')
        .order('updated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ])
    const lastSuccessAt = ok.data
      ? ((ok.data.reviewed_at as string | null) ?? (ok.data.updated_at as string | null) ?? (ok.data.created_at as string | null))
      : null
    // The last error: the latest recorded gateway error, or a payment the gateway
    // declined — whichever is newer, in plain English.
    let lastError: GatewayHealth['lastError'] = err.data
      ? { at: err.data.created_at as string, message: (err.data.message as string | null) ?? 'An error was recorded.' }
      : null
    const declinedAt = (rejected.data?.updated_at as string | null) ?? null
    if (declinedAt && (!lastError || declinedAt > lastError.at)) {
      lastError = { at: declinedAt, message: 'A payment did not go through and was marked failed.' }
    }
    return {
      id,
      name,
      connected: configured[id],
      lastSuccessAt,
      lastError,
      lastCallbackAt: (cb.data?.created_at as string | null) ?? null,
      pendingOverHour: pend.count ?? 0,
    }
  }

  const [paypro, assan, latestOrder] = await Promise.all([
    one('paypro', 'PayPro'),
    one('assanpay', 'AssanPay'),
    admin.from('payments').select('raw, created_at').eq('provider', 'paypro')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const raw = (latestOrder.data?.raw as { paypro?: { isFeeApplied?: unknown } } | null) ?? null
  const reported = raw?.paypro?.isFeeApplied
  return {
    gateways: [paypro, assan],
    fee: {
      lastReported: reported === undefined || reported === null || reported === '' ? null : String(reported),
      lastOrderAt: (latestOrder.data?.created_at as string | null) ?? null,
    },
  }
}
