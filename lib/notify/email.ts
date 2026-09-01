// lib/notify/email.ts
//
// Email delivery through Resend, over their HTTP API rather than their SDK --
// one fetch, no dependency, and nothing to keep in step at upgrade time.
//
// Two implementations behind one interface:
//
//   resendChannel  — the real one. Needs RESEND_API_KEY.
//   consoleChannel — prints the message to the server log. Used in development
//                    when no key is set, so that a developer can read what
//                    would have been sent instead of discovering three weeks
//                    later that an email was never wired up. It reports ok:true
//                    because from the caller's point of view delivery did what
//                    this environment can do; the log line says CONSOLE so the
//                    difference is never invisible.
//
// On the LIVE SITE a missing key is NOT quietly swapped for the console: it
// returns ok:false with a reason, and getEmailChannel() logs it once. A
// production deploy that thinks it is sending mail and is not is worse than one
// that says it cannot.
//
// A Vercel preview does get the console adapter. The alternatives are a tester
// silently receiving nothing, or real mail going to real addresses from a
// branch -- both worse than a log line somebody can read.

import type { DeliveryChannel, DeliveryResult, OutboundMessage } from './channel'
import { isProduction } from '@/lib/env'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** The From address. Set MAIL_FROM to override the default. */
export function mailFrom(): string {
  return process.env.MAIL_FROM ?? 'TutorMint <noreply@tutormint.org>'
}

const resendChannel: DeliveryChannel = {
  id: 'email',

  isConfigured() {
    return !!process.env.RESEND_API_KEY
  },

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const key = process.env.RESEND_API_KEY
    if (!key) return { ok: false, reason: 'RESEND_API_KEY is not set', channel: 'email' }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: mailFrom(),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      })

      if (!res.ok) {
        // Resend's error body is small and specific ("domain not verified",
        // "invalid to address"). Carrying it through is the difference between
        // a five-minute fix and an afternoon.
        const body = await res.text()
        return { ok: false, reason: `Resend ${res.status}: ${body.slice(0, 300)}`, channel: 'email' }
      }

      const json = (await res.json()) as { id?: string }
      return { ok: true, id: json.id ?? null, channel: 'email' }
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.message : 'network error',
        channel: 'email',
      }
    }
  },
}

const consoleChannel: DeliveryChannel = {
  id: 'email',
  isConfigured() {
    return true
  },
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    console.log(
      [
        '',
        '─── EMAIL (CONSOLE — no RESEND_API_KEY set) ──────────────────',
        `To:      ${message.to}`,
        `From:    ${mailFrom()}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '──────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
    return { ok: true, id: null, channel: 'email' }
  },
}

let warned = false

export function getEmailChannel(): DeliveryChannel {
  if (resendChannel.isConfigured()) return resendChannel

  if (isProduction()) {
    if (!warned) {
      console.error('[notify] RESEND_API_KEY is not set in production — no email will be sent')
      warned = true
    }
    return resendChannel // reports ok:false, with the reason
  }

  return consoleChannel
}
