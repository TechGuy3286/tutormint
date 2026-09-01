// lib/sms/twilio.ts
//
// Twilio, over its REST API rather than the SDK: one form POST, no dependency,
// and nothing that has to be kept in step at upgrade time. The twilio npm
// package is a large tree whose only job here would be to build this request.
//
// Configuration (all four required):
//   TWILIO_ACCOUNT_SID    ACxxxxxxxx…
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM           the sending number, E.164, e.g. +12025550123
//                         (or a Messaging Service SID in TWILIO_MESSAGING_SERVICE_SID)
//
// Numbers are sent in E.164. Pakistani mobiles are stored and normalised as a
// bare MSISDN (923001234567) by lib/phone.ts, so the only transformation here
// is the leading "+". Doing it at the edge, once, is what stops "03001234567"
// reaching a carrier that has no idea what a leading zero means.

import type { SmsProvider, SmsResult } from './provider'
import { normalisePkMobile } from '@/lib/phone'

const API = 'https://api.twilio.com/2010-04-01'

export const twilioProvider: SmsProvider = {
  name: 'twilio',

  isConfigured() {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID),
    )
  },

  async send(to: string, body: string): Promise<SmsResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM
    const service = process.env.TWILIO_MESSAGING_SERVICE_SID

    if (!sid || !token || (!from && !service)) {
      return { ok: false, provider: 'twilio', error: 'TWILIO_* environment variables are not set' }
    }

    const msisdn = normalisePkMobile(to)
    if (!msisdn) {
      return { ok: false, provider: 'twilio', error: `not a Pakistani mobile number: ${to}` }
    }

    const form = new URLSearchParams({ To: `+${msisdn}`, Body: body })
    // A Messaging Service handles sender selection and is what you want once
    // there is more than one number; a bare From is fine for one.
    if (service) form.set('MessagingServiceSid', service)
    else form.set('From', from as string)

    try {
      const res = await fetch(`${API}/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })

      const json = (await res.json()) as { sid?: string; message?: string; code?: number }

      if (!res.ok) {
        // Twilio's own message is specific and worth keeping ("The 'To' number
        // is not a valid phone number", "Permission to send an SMS has not been
        // enabled for the region"). The second one in particular is an account
        // setting, not a bug, and only the message says so.
        return {
          ok: false,
          provider: 'twilio',
          error: `Twilio ${res.status}${json.code ? ` (${json.code})` : ''}: ${json.message ?? 'request failed'}`,
        }
      }

      return { ok: true, provider: 'twilio', id: json.sid ?? null }
    } catch (e) {
      return {
        ok: false,
        provider: 'twilio',
        error: e instanceof Error ? e.message : 'network error',
      }
    }
  },
}
