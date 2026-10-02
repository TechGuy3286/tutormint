import 'server-only'
import https from 'node:https'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile } from '@/lib/phone'
import { onlinePaymentOpenFrom } from '@/lib/payments/paymentOpen'

// PayPro API v2 client (PR65). Sandbox → https://demoapi.paypro.com.pk.
//
// SECURITY. This module is the only thing that talks to PayPro. It never logs,
// prints or returns a token, password, secret or card detail. The auth token
// lives only in a module-level cache and in the request header; it is never put
// in a payments row, a response body or a log line.
//
// It does NOT activate anything. Activation stays in lib/payments/activate.ts and
// is reached only after ggos confirms PAID and the amount matches — the callback
// and the reconcile cron both go through activatePayment, which is idempotent.
//
// Request shapes follow docs/paypro/PAYPRO_API_VERSION_2_postman_collection.json
// exactly: auth body {clientid, clientsecret} with the token in the RESPONSE
// header (named `token` in sandbox, `Token` live — node lowercases both to
// `token`); create-order /v2/ppro/co as a JSON array [{MerchantId}, {order…}]
// with dd/MM/yyyy dates; and ggos /v2/ppro/ggos as a GET carrying a JSON body
// {userName, cpayId} — which undici `fetch` forbids, so every call uses node:https.

const BASE = () => (process.env.PAYPRO_BASE_URL ?? '').replace(/\/+$/, '')
const USERNAME = () => process.env.PAYPRO_USERNAME ?? ''

export function pproConfigured(): boolean {
  return !!(
    process.env.PAYPRO_BASE_URL &&
    process.env.PAYPRO_USERNAME &&
    process.env.PAYPRO_PASSWORD &&
    process.env.PAYPRO_CLIENT_ID &&
    process.env.PAYPRO_CLIENT_SECRET
  )
}

/** True while the base URL is the demo/sandbox API. Drives the owner/staff-only
 *  gating (§6): a sandbox gateway must never take a real member's money. */
export function pproSandbox(): boolean {
  return BASE().includes('demoapi')
}

/**
 * THE shared source of truth for "online payment is open" (PR106-C0 §1).
 *
 * Open ⟺ the PayPro gateway is genuinely LIVE: configured AND not the sandbox.
 * This is the SAME fact the working checkout uses to actually take a card
 * payment, so the open/closed decision can never drift from whether a payment
 * would really go through. Every gate — the checkout route, the Membership Plans
 * page, the verify/fee step, the upgrade sheet — resolves through this. When it
 * is false (sandbox or unconfigured) a normal member sees "not open yet"; that is
 * the only case the closed notice appears.
 */
export function onlinePaymentOpen(): boolean {
  return onlinePaymentOpenFrom({ configured: pproConfigured(), sandbox: pproSandbox() })
}

/** Emails allow-listed for sandbox PayPro checkout (PR66 §3), case-insensitive. */
function payproTestEmails(): Set<string> {
  return new Set(
    (process.env.PAYPRO_TEST_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

type GateProfile = {
  admin_role?: string | null
  is_seed?: boolean | null
  email?: string | null
}

/**
 * Who may check out AT ALL during the gated launch phase (PR98 §2).
 *
 * Owner/staff (admin_role set), a seed test account, or an email listed in
 * PAYPRO_TEST_EMAILS — and NOBODY else, whether PayPro is sandbox or live. We
 * are going live with a gated audience first, so a normal member sees no
 * checkout yet regardless of the gateway's mode.
 *
 * FAIL CLOSED: if PAYPRO_TEST_EMAILS is missing or empty, only owner/staff/seed
 * get checkout — never a normal member. The email set is simply empty, so the
 * membership test below is false for every normal account.
 */
export function checkoutVisibleFor(profile: GateProfile): boolean {
  if (profile.admin_role || profile.is_seed) return true
  const email = (profile.email ?? '').trim().toLowerCase()
  return !!email && payproTestEmails().has(email)
}

/** Whether the PayPro (card) option is offered to this account.
 *
 *  PR106-C0 §2: once the gateway is LIVE, PayPro is the normal pay option for
 *  EVERYONE — the launch-phase gating (test accounts only) applied while the
 *  gateway was being brought up and is now lifted. In SANDBOX it stays owner/
 *  staff/seed/test-email only, so a demo gateway never takes a real member's
 *  money. Unconfigured → never. */
export function pproVisibleFor(profile: GateProfile): boolean {
  if (!pproConfigured()) return false
  if (pproSandbox()) return checkoutVisibleFor(profile)
  return true
}

// ── low-level transport ─────────────────────────────────────────────────────

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; text: string }

function rawRequest(
  method: 'GET' | 'POST',
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(BASE() + path)
    } catch {
      reject(new Error('PayPro base URL is not configured.'))
      return
    }
    const data = opts.body != null ? Buffer.from(opts.body, 'utf8') : null
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(data ? { 'Content-Length': String(data.length) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (chunks += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: chunks }))
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('PayPro request timed out')))
    // node:https permits a body on GET (unlike undici fetch), which ggos needs.
    if (data) req.write(data)
    req.end()
  })
}

// ── auth token (15-min, cached, refreshed early / on 401) ───────────────────

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && tokenCache && tokenCache.expiresAt > now) return tokenCache.token
  const res = await rawRequest('POST', '/v2/ppro/auth', {
    body: JSON.stringify({
      clientid: process.env.PAYPRO_CLIENT_ID ?? '',
      clientsecret: process.env.PAYPRO_CLIENT_SECRET ?? '',
    }),
  })
  // Token is in the response HEADER (case-insensitive; node lowercases to `token`).
  const raw = res.headers['token']
  const token = Array.isArray(raw) ? raw[0] : raw
  if (!token) throw new Error(`auth_failed_${res.status}`)
  // Refresh at 13 minutes to stay inside the 15-minute lifetime.
  tokenCache = { token, expiresAt: now + 13 * 60 * 1000 }
  return token
}

/** Run an authed call, refreshing the token once on an HTTP 401. */
async function withToken(fn: (token: string) => Promise<RawResponse>): Promise<RawResponse> {
  const first = await fn(await getToken())
  if (first.status !== 401) return first
  return fn(await getToken(true))
}

// ── date + customer helpers ─────────────────────────────────────────────────

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** PayPro wants 03XXXXXXXXX (11 digits) or empty. */
export function toPayproMobile(raw: string | null | undefined): string {
  if (!raw) return ''
  const msisdn = normalisePkMobile(raw) // 923001234567 or null
  if (msisdn && /^92\d{10}$/.test(msisdn)) return '0' + msisdn.slice(2) // → 03001234567
  return ''
}

// ── create order ────────────────────────────────────────────────────────────

export type CreateOrderResult =
  | { ok: true; payProId: string; click2pay: string; isFeeApplied: string; orderAmount: number; raw: Record<string, unknown> }
  | { ok: false; error: string }

export async function createPayproOrder(o: {
  orderNumber: string
  amountPkr: number
  customerName: string
  customerMobile: string
  customerEmail: string
  customerAddress: string
}): Promise<CreateOrderResult> {
  const now = new Date()
  const due = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 1-day default (§2)
  const bodyArr = [
    { MerchantId: USERNAME() },
    {
      OrderNumber: o.orderNumber,
      OrderAmount: String(o.amountPkr),
      OrderDueDate: ddmmyyyy(due),
      OrderType: 'Service',
      IssueDate: ddmmyyyy(now),
      OrderExpireAfterSeconds: '0',
      CustomerName: (o.customerName || 'Customer').slice(0, 32),
      CustomerMobile: o.customerMobile || '',
      CustomerEmail: o.customerEmail || '',
      CustomerAddress: o.customerAddress || '',
    },
  ]
  let res: RawResponse
  try {
    res = await withToken((token) =>
      rawRequest('POST', '/v2/ppro/co', { headers: { token }, body: JSON.stringify(bodyArr) }),
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'PayPro create-order failed.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(res.text)
  } catch {
    return { ok: false, error: `PayPro returned a non-JSON response (status ${res.status}).` }
  }
  const arr = Array.isArray(parsed) ? parsed : []
  const status = (arr[0] as { Status?: string } | undefined)?.Status
  const data = (arr[1] as Record<string, unknown> | undefined) ?? {}
  const click2pay = typeof data.Click2Pay === 'string' ? data.Click2Pay : ''
  if (status !== '00' || !click2pay) {
    const desc = typeof data.Description === 'string' ? data.Description : `status ${status ?? res.status}`
    return { ok: false, error: `PayPro create-order failed: ${desc}` }
  }
  return {
    ok: true,
    payProId: String(data.PayProId ?? ''),
    click2pay,
    isFeeApplied: String(data.IsFeeApplied ?? ''),
    orderAmount: Number(data.OrderAmount ?? o.amountPkr),
    raw: data,
  }
}

// ── get order status (ggos) ──────────────────────────────────────────────────

export type OrderStatusResult =
  | {
      ok: true
      orderStatus: string
      /** OrderAmountPaid — what the customer actually paid (may include PayPro's fee). */
      amountPaid: number
      /** AmountPayable — the bill amount PayPro holds for the order (what we created it for). */
      amountPayable: number
      /** OrderNumber PayPro echoes back — must match our provider_ref. */
      orderNumber: string
      raw: Record<string, unknown>
    }
  | { ok: false; error: string }

export async function getPayproOrderStatus(payProId: string): Promise<OrderStatusResult> {
  if (!payProId) return { ok: false, error: 'No PayProId on this order.' }
  let res: RawResponse
  try {
    // ggos carries the merchant username in the body AND needs the auth token
    // header on LIVE (sandbox did not, hence the old "no token" note — live
    // returns HTTP 401 without it, PR104). withToken adds it and refreshes once
    // on a 401. GET-with-body → node:https, not fetch.
    res = await withToken((token) =>
      rawRequest('GET', '/v2/ppro/ggos', {
        headers: { token },
        body: JSON.stringify({ userName: USERNAME(), cpayId: payProId }),
      }),
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'PayPro status check failed.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(res.text)
  } catch {
    return { ok: false, error: `PayPro status returned non-JSON (status ${res.status}).` }
  }
  const arr = Array.isArray(parsed) ? parsed : []
  const status = (arr[0] as { Status?: string } | undefined)?.Status
  const data = (arr[1] as Record<string, unknown> | undefined) ?? {}
  if (status !== '00') {
    const desc = typeof data.Description === 'string' ? data.Description : `status ${status ?? res.status}`
    return { ok: false, error: desc }
  }
  return {
    ok: true,
    orderStatus: String(data.OrderStatus ?? '').toUpperCase(),
    amountPaid: Number(data.OrderAmountPaid ?? 0),
    // AmountPayable is the order's bill (our price); fall back to OrderAmountPaid
    // if PayPro omits it, so an order that is genuinely paid is not rejected
    // merely because the payable field is absent.
    amountPayable: Number(data.AmountPayable ?? data.OrderAmountPaid ?? 0),
    orderNumber: String(data.OrderNumber ?? ''),
    raw: data,
  }
}

// ── mark order blocked (ppro/moab) — cancel/expire an unpaid order ───────────

export type BlockOrderResult = { ok: boolean; status?: string; description?: string; error?: string }

/** Block (cancel/expire) an unpaid order by its order NUMBER (our provider_ref).
 *  Used by the owner diagnostic (PR98 §1) to tidy up the one Rs 199 test order so
 *  the reconcile cron is not left chasing it. Never logs secrets. */
export async function markPayproOrderBlocked(orderNumber: string): Promise<BlockOrderResult> {
  if (!orderNumber) return { ok: false, error: 'No order number.' }
  let res: RawResponse
  try {
    res = await withToken((token) =>
      rawRequest('POST', '/v2/ppro/moab', {
        headers: { token },
        body: JSON.stringify({ Username: USERNAME(), CsvOrderNumbers: orderNumber }),
      }),
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'PayPro block failed.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(res.text)
  } catch {
    return { ok: false, error: `PayPro block returned non-JSON (status ${res.status}).` }
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  const first = (arr[0] as { Status?: string; Description?: string } | undefined) ?? {}
  return {
    ok: first.Status === '00',
    status: first.Status,
    description: typeof first.Description === 'string' ? first.Description : undefined,
  }
}

// ── health (owner check) ─────────────────────────────────────────────────────

/** Calls auth and reports OK or the error type — never the token. */
export async function pproAuthHealth(): Promise<{ ok: boolean; error?: string; sandbox: boolean; host: string }> {
  const host = (() => {
    try {
      return new URL(BASE()).host
    } catch {
      return ''
    }
  })()
  if (!pproConfigured()) return { ok: false, error: 'not_configured', sandbox: pproSandbox(), host }
  try {
    await getToken(true)
    return { ok: true, sandbox: pproSandbox(), host }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'auth_failed', sandbox: pproSandbox(), host }
  }
}

// ── the order number (§2) ────────────────────────────────────────────────────

/** TM-<yyyyMMddHHmmss>-<random>. Unique per attempt; our order id AND the
 *  payments.provider_ref the callback matches on. */
export function payproOrderNumber(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  return `TM-${stamp}-${rand}`
}

// ── start a PayPro checkout: create the order + the pending payments row ─────

export type StartResult =
  | { ok: true; url: string; reference: string; paymentId: string }
  | { ok: false; status: number; error: string }

/**
 * Create the PayPro order and the pending payments row (service role), and
 * return the Click2Pay URL. The amount is passed in by the caller from the
 * `plans` table — never from the client. PayPro's fee is absorbed by the
 * merchant (IsFeeApplied handled by the account), so the customer pays exactly
 * this amount; the response's IsFeeApplied is stored for the report.
 */
export async function startPayproCheckout(params: {
  userId: string
  planCode: string
  amountPkr: number
  customer: { name: string; mobile: string; email: string }
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null }
}): Promise<StartResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  // DUPLICATE GUARD (PR104 §3). If the member already has a pending PayPro order
  // for this same plan, do NOT create a second one (which is how two live orders
  // appeared for one tutor). A recent one (< 24h) is REUSED — send them back to
  // its Click2Pay link. An older one is blocked at PayPro and marked rejected,
  // then a fresh order is created below.
  const DAY_MS = 24 * 60 * 60 * 1000
  const { data: pendings } = await admin
    .from('payments')
    .select('id, provider_ref, created_at, raw')
    .eq('user_id', params.userId)
    .eq('plan_code', params.planCode)
    .eq('provider', 'paypro')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)
  for (const p of pendings ?? []) {
    const ageMs = Date.now() - new Date(p.created_at as string).getTime()
    const click2pay = (p.raw as { paypro?: { click2pay?: string } } | null)?.paypro?.click2pay ?? ''
    if (ageMs < DAY_MS && click2pay) {
      // Reuse the most recent still-fresh order.
      return { ok: true, url: click2pay, reference: p.provider_ref as string, paymentId: p.id as string }
    }
    // Stale (or no link): block it at PayPro and mark it rejected so it cannot be
    // paid by mistake, then fall through to create a fresh order.
    try {
      await markPayproOrderBlocked(p.provider_ref as string)
    } catch {
      /* best-effort; the order is stale regardless */
    }
    await admin
      .from('payments')
      .update({ status: 'rejected', rejection_reason: 'Expired checkout — replaced by a new order.', updated_at: new Date().toISOString() })
      .eq('id', p.id as string)
      .eq('status', 'pending')
  }

  const reference = payproOrderNumber()
  const order = await createPayproOrder({
    orderNumber: reference,
    amountPkr: params.amountPkr,
    customerName: params.customer.name,
    customerMobile: params.customer.mobile,
    customerEmail: params.customer.email,
    customerAddress: '',
  })
  if (!order.ok) return { ok: false, status: 502, error: order.error }

  // Correctness reads the PayProId back from `raw` (always present), so the code
  // works whether or not the paypro_id / click2pay_url columns exist yet.
  const { data: row, error } = await admin
    .from('payments')
    .insert({
      user_id: params.userId,
      plan_code: params.planCode,
      amount_pkr: params.amountPkr,
      status: 'pending',
      provider: 'paypro',
      provider_ref: reference,
      method: null,
      utm_source: params.utm.source,
      utm_medium: params.utm.medium,
      utm_campaign: params.utm.campaign,
      utm_content: params.utm.content,
      raw: {
        paypro: {
          payProId: order.payProId,
          click2pay: order.click2pay,
          isFeeApplied: order.isFeeApplied,
          orderAmount: order.orderAmount,
        },
      },
    })
    .select('id')
    .single()

  if (error || !row) return { ok: false, status: 400, error: error?.message ?? 'Could not record the payment.' }

  // Best-effort: mirror into dedicated columns for the owner's SQL. Wrapped so a
  // pre-migration deploy (columns absent) simply skips it — raw is the source.
  try {
    await admin
      .from('payments')
      .update({ paypro_id: order.payProId, click2pay_url: order.click2pay })
      .eq('id', row.id)
  } catch {
    /* columns not there yet — raw already holds the PayProId */
  }

  return { ok: true, url: order.click2pay, reference, paymentId: row.id as string }
}

/** The PayProId stored on a payments row (from the column, or `raw` fallback). */
export function payProIdFromRow(row: { paypro_id?: string | null; raw?: unknown }): string {
  if (row.paypro_id) return row.paypro_id
  const raw = row.raw as { paypro?: { payProId?: string } } | null
  return raw?.paypro?.payProId ?? ''
}
