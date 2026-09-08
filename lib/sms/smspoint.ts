// lib/sms/smspoint.ts
//
// SMS Point (smspoint.pk) — the live OTP delivery provider. The code is
// delivered as a WhatsApp message from an approved business number; SMS on the
// same account does not deliver, so the member-facing copy says "on WhatsApp".
//
//   GET https://smspoint.pk/api/sendsms/
//     ?username=&password=&clientid=&msg=&to=&mask=&Language=English
//
// FIRE-AND-FORGET (probe finding, Part 7 stage 1). A success is HTTP 200 with a
// plain-text body "Sent Successfully" — but a NON-EXISTENT number returned the
// SAME 200 "Sent Successfully", and an exhausted prepaid balance is assumed to
// as well. There is no delivery receipt and no error shape, so a success from
// this provider means ACCEPTED FOR DELIVERY, never DELIVERED. That is why:
//   - send() returns ok:true only for 200 + a success marker (so a bad-
//     credentials / malformed-request response, which does NOT say "success",
//     still fails closed — the one class of failure that IS detectable), and
//   - the member-facing copy never claims more than "sent on WhatsApp", with the
//     support fallback ALWAYS visible rather than hidden behind a failure the
//     system can never detect (see /verify-phone and the completion Mobile step).
//
// CREDENTIALS FROM ENV ONLY (SMSPOINT_USERNAME / _PASSWORD / _CLIENTID / _MASK).
// Missing any one ⇒ isConfigured() is false ⇒ getSmsProvider() falls through to
// the unconfigured provider in production (fail closed, never a silent success).
//
// NEVER LOG A FULL NUMBER OR A CODE. The request URL carries both the code (in
// `msg`) and the credentials, so it is never logged, echoed, or put in an error.
// The only text that reaches an error string is the provider's OWN response body
// (its status text, e.g. "Sent Successfully"), which never echoes `msg`, bounded
// to 120 chars.

import type { SmsProvider, SmsResult } from './provider'
import { normalisePkMobile } from '@/lib/phone'

export const SMSPOINT_ENDPOINT = 'https://smspoint.pk/api/sendsms/'

const CRED_KEYS = ['SMSPOINT_USERNAME', 'SMSPOINT_PASSWORD', 'SMSPOINT_CLIENTID', 'SMSPOINT_MASK'] as const

export type SmspointCreds = {
  username: string
  password: string
  clientid: string
  mask: string
}

/**
 * The request URL, built PURELY from the passed credentials and message — no
 * hardcoded values, no env read. Extracted so a test can assert the URL is
 * assembled correctly from env without a network call, and so send() has exactly
 * one place that shapes the request. The result carries the code and the
 * credentials, so callers must never log it.
 */
export function smspointUrl(creds: SmspointCreds, to: string, body: string): string {
  const q = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    clientid: creds.clientid,
    msg: body,
    to,
    mask: creds.mask,
    Language: 'English',
  })
  return `${SMSPOINT_ENDPOINT}?${q.toString()}`
}

/** Read the four credentials from env, or null when any is missing/blank. */
function credsFromEnv(): SmspointCreds | null {
  const username = process.env.SMSPOINT_USERNAME?.trim()
  const password = process.env.SMSPOINT_PASSWORD?.trim()
  const clientid = process.env.SMSPOINT_CLIENTID?.trim()
  const mask = process.env.SMSPOINT_MASK?.trim()
  if (!username || !password || !clientid || !mask) return null
  return { username, password, clientid, mask }
}

/** A 200 with a success marker in the body. The provider's success text is
 *  "Sent Successfully"; matched loosely on "success" so minor wording/casing
 *  changes do not read as a failure, while a credentials/format error (which
 *  does NOT say success) fails closed. */
export function smspointAccepted(status: number, body: string): boolean {
  return status >= 200 && status < 300 && /success/i.test(body)
}

export const smspointProvider: SmsProvider = {
  name: 'smspoint',

  isConfigured() {
    return CRED_KEYS.every((k) => !!process.env[k]?.trim())
  },

  async send(to: string, body: string): Promise<SmsResult> {
    const creds = credsFromEnv()
    if (!creds) {
      return { ok: false, provider: 'smspoint', error: 'SMSPOINT_* environment variables are not set' }
    }

    // Every destination goes through the one canonical normaliser, so a leading
    // zero or a typed +92 cannot reach the provider in a shape it misreads.
    const msisdn = normalisePkMobile(to)
    if (!msisdn) {
      return { ok: false, provider: 'smspoint', error: 'not a Pakistani mobile number' }
    }

    const url = smspointUrl(creds, msisdn, body)

    let res: Response
    try {
      // A GET with a timeout: a hung provider must not hold the OTP route open.
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) })
    } catch (e) {
      // The thrown error is a fetch/network/timeout message — it does not carry
      // the URL — but the URL is never referenced here regardless.
      const msg = e instanceof Error ? e.message : 'network error'
      return { ok: false, provider: 'smspoint', error: `SMS Point request failed: ${msg}` }
    }

    const text = (await res.text()).trim()
    if (smspointAccepted(res.status, text)) {
      // Accepted for delivery — NOT confirmed delivered (see the header note).
      return { ok: true, provider: 'smspoint' }
    }

    // A detectable failure: bad credentials, a malformed request, a non-2xx.
    // The body is the provider's own status text (never an echo of `msg`, so it
    // carries no code), bounded. The URL is never included.
    return {
      ok: false,
      provider: 'smspoint',
      error: `SMS Point rejected the request (HTTP ${res.status}: ${text.slice(0, 120) || 'empty response'})`,
    }
  },
}
