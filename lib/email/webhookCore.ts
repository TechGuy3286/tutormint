// lib/email/webhookCore.ts — PURE. The Resend webhook's signature check
// (owner, 27 Oct 2026). Resend signs its webhooks the Svix way:
//   signed content  = `${svix-id}.${svix-timestamp}.${raw body}`
//   key             = the base64 part of the secret after "whsec_"
//   svix-signature  = space-separated "v1,<base64 HMAC-SHA256>" entries
// The timestamp must be within 5 minutes. The secret is never logged.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const TOLERANCE_SECONDS = 5 * 60

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null }

export function signPayload(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

export function verifyWebhook(secret: string | null | undefined, h: WebhookHeaders, body: string, nowSeconds: number): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false
  const ts = Number(h.timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false
  const expected = Buffer.from(signPayload(secret, h.id, h.timestamp, body))
  for (const part of h.signature.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    const got = Buffer.from(sig)
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true
  }
  return false
}

export type WebhookAction =
  | { kind: 'do_not_email'; reason: 'bounced' | 'complained'; addresses: string[]; emailId: string | null }
  | { kind: 'opened'; emailId: string }
  | { kind: 'ignore' }

/** What one Resend event means for us. */
export function webhookAction(event: unknown): WebhookAction {
  const e = (event ?? {}) as { type?: unknown; data?: { email_id?: unknown; to?: unknown } }
  const type = typeof e.type === 'string' ? e.type : ''
  const emailId = typeof e.data?.email_id === 'string' ? e.data.email_id : null
  const to = Array.isArray(e.data?.to) ? e.data!.to.filter((x): x is string => typeof x === 'string') : typeof e.data?.to === 'string' ? [e.data.to] : []
  if (type === 'email.bounced') return { kind: 'do_not_email', reason: 'bounced', addresses: to, emailId }
  if (type === 'email.complained') return { kind: 'do_not_email', reason: 'complained', addresses: to, emailId }
  if (type === 'email.opened' && emailId) return { kind: 'opened', emailId }
  return { kind: 'ignore' }
}
