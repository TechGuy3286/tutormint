// lib/sms/sendpk.ts
//
// SendPK (sendpk.com) — OTP delivery over a fixed, pre-approved template.
// Contract established by scripts/sendpk-probe.ts against the live account, and
// trusted OVER https://sendpk.com/api.php, which is wrong in three places (below).
//
//   POST https://sendpk.com/api/sms.php
//     api_key, sender, mobile, template_id, message, format=json
//
// POST, not GET: the key travels in the body, out of the server's access logs.
// `message` is a JSON STRING of the TEMPLATE's variables only — SendPK rejects
// free text, so we do not control the wording. Template 10728 takes exactly one
// variable, `otp`, so `message` is {"otp":"123456"}: the rendered sentence is
// the template's own ("Your TutorMint verification code is #otp#. …"), not the
// body string this adapter is handed. So send() EXTRACTS the numeric code from
// the body and drops it into that one variable; if the body carries no code we
// fail closed rather than send something the template cannot render.
// SENDPK_TEMPLATE_ID and the {"otp":…} shape are therefore coupled — a different
// template with different variables needs this mapping changed.
//
// SUCCESS is body-driven, never status-driven (probe, verbatim):
//   {"success":"true","type":"API","totalprice":"4.8","totalgsm":"1",
//    "remaincredit":"31.20 PKR","results":[{"status":"OK",
//    "messageid":"<uuid>","gsm":"923211045245"}]}
// The ONLY success is success==="true" AND results[0].status==="OK". Every other
// body is a failure, whatever it contains.
//
// THREE DOCUMENTATION ERRORS this codes against:
//   1. The published status table stops at 9 and calls invalid-recipient 7 — but
//      a dead number actually returns 12. So we DO NOT switch on a code list:
//      anything that is not the clean success shape is a failure.
//   2. Code 1 means BOTH "invalid api key" AND "IP not whitelisted", told apart
//      only by the message text. So the FULL provider text is logged and returned
//      on failure, never just the code — else an expired key and a blocked IP
//      look identical in production.
//   3. The message id is a UUID, not the numeric "ID:29346" the docs show.
//
// CREDENTIALS FROM ENV ONLY. All four of SENDPK_API_KEY / _SENDER / _TEMPLATE_ID
// / _BASE_URL are required; missing any ⇒ isConfigured() false ⇒ selection falls
// through (fail closed, never a silent success). The api_key is NEVER logged.

import type { SmsProvider, SmsResult } from './provider'
import { normalisePkMobile } from '@/lib/phone'

export type SendpkConfig = {
  apiKey: string
  sender: string
  templateId: string
  baseUrl: string
}

/** All four env vars, trimmed, or null when any is missing/blank. */
function configFromEnv(): SendpkConfig | null {
  const apiKey = process.env.SENDPK_API_KEY?.trim()
  const sender = process.env.SENDPK_SENDER?.trim()
  const templateId = process.env.SENDPK_TEMPLATE_ID?.trim()
  const baseUrl = process.env.SENDPK_BASE_URL?.trim()
  if (!apiKey || !sender || !templateId || !baseUrl) return null
  return { apiKey, sender, templateId, baseUrl }
}

/** The send endpoint, tolerant of a trailing slash on the base URL. */
export function sendpkEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/sms.php`
}

/**
 * The single template variable's value: the verification code. The body handed
 * to send() is otp.ts's sentence ("… code is 123456. It expires in 10 minutes."),
 * from which we take the first run of 4–8 digits — the 6-digit code, never the
 * "10" of "10 minutes". Null when the body carries no such run, so send() can
 * refuse rather than post an empty variable.
 */
export function otpDigits(body: string): string | null {
  return body.match(/\d{4,8}/)?.[0] ?? null
}

/** The POST params. Pure, so a test can assert the shape without a network call. */
export function sendpkParams(cfg: SendpkConfig, mobile: string, otp: string): URLSearchParams {
  return new URLSearchParams({
    api_key: cfg.apiKey,
    sender: cfg.sender,
    mobile,
    template_id: cfg.templateId,
    // Template variables only — SendPK rejects free text. Template 10728: {otp}.
    message: JSON.stringify({ otp }),
    format: 'json',
  })
}

export type SendpkParsed =
  | { ok: true; messageid: string; totalprice: string | null; remaincredit: string | null }
  | { ok: false; message: string }

/**
 * Classify a raw response body. The ONLY success is a JSON object with
 * success==="true" and results[0].status==="OK"; everything else — a plain-text
 * "N : reason" failure, a non-OK result, or an unparseable body — is a failure
 * carrying the provider's own text (bounded), never a synthesised message.
 */
export function parseSendpkResponse(body: string): SendpkParsed {
  const text = (body ?? '').trim()

  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    const success = String(o.success ?? '').toLowerCase() === 'true'
    const results = Array.isArray(o.results) ? (o.results as Array<Record<string, unknown>>) : []
    const first = results[0]
    const statusOk = String(first?.status ?? '').toUpperCase() === 'OK'
    if (success && statusOk) {
      return {
        ok: true,
        messageid: first?.messageid != null ? String(first.messageid) : '',
        totalprice: o.totalprice != null ? String(o.totalprice) : null,
        remaincredit: o.remaincredit != null ? String(o.remaincredit) : null,
      }
    }
  }

  return { ok: false, message: text.slice(0, 200) || 'empty response' }
}

export const sendpkProvider: SmsProvider = {
  name: 'sendpk',

  isConfigured() {
    return configFromEnv() !== null
  },

  async send(to: string, body: string): Promise<SmsResult> {
    const cfg = configFromEnv()
    if (!cfg) {
      return { ok: false, provider: 'sendpk', error: 'SENDPK_* environment variables are not set' }
    }

    // One canonical normaliser (lib/phone.ts) — never a second one here.
    const msisdn = normalisePkMobile(to)
    if (!msisdn) {
      return { ok: false, provider: 'sendpk', error: 'not a Pakistani mobile number' }
    }

    const otp = otpDigits(body)
    if (!otp) {
      // SendPK sends the fixed OTP template, not the body verbatim; with no code
      // to fill the variable there is nothing valid to send.
      return {
        ok: false,
        provider: 'sendpk',
        error: 'no verification code found in the message body',
      }
    }

    const params = sendpkParams(cfg, msisdn, otp)

    let res: Response
    try {
      // POST keeps the key out of access logs. A timeout so a hung provider
      // cannot hold the OTP route open.
      res = await fetch(sendpkEndpoint(cfg.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network error'
      return { ok: false, provider: 'sendpk', error: `SendPK request failed: ${msg}` }
    }

    const text = (await res.text()).trim()
    const parsed = parseSendpkResponse(text)

    if (parsed.ok) {
      // Per send at info: at 4.80 PKR a message a runaway loop is a real cost,
      // and remaincredit falling is the earliest warning. Never the api_key,
      // never the number, never the code.
      console.info(
        `[sms] sendpk ok messageid=${parsed.messageid || '?'} ` +
          `totalprice=${parsed.totalprice ?? '?'} remaincredit=${JSON.stringify(parsed.remaincredit ?? '?')}`,
      )
      // Carry the messageid so it lands in the OTP log line (reportSend).
      return { ok: true, provider: 'sendpk', id: parsed.messageid || null }
    }

    // Full provider text on failure (doc-error #2). The body never contains the
    // api_key; it is not included in the URL and this is a POST.
    console.warn(`[sms] sendpk failed http=${res.status} body=${JSON.stringify(parsed.message)}`)
    return { ok: false, provider: 'sendpk', error: parsed.message }
  },
}
