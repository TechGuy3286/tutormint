// lib/sms.ts
//
// SMS / WhatsApp provider interface.
//
// No real provider is wired up yet -- that is a T8 launch item. This module
// exists so the OTP route talks to a stable interface now and the provider can
// be dropped in without touching the route.
//
// Deliberately does NOT fall back to "pretend it worked" in production: if no
// provider is configured, send() reports failure and the caller surfaces that
// honestly rather than telling a user a code is on its way when it is not.

export type SmsResult =
  | { ok: true; provider: string }
  | { ok: false; provider: string; error: string }

export interface SmsProvider {
  name: string
  send(to: string, body: string): Promise<SmsResult>
}

/**
 * Placeholder provider. Replace in T8 with the real integration (Twilio,
 * a local Pakistani aggregator, or the WhatsApp Business API).
 */
const notConfigured: SmsProvider = {
  name: 'none',
  async send(): Promise<SmsResult> {
    return {
      ok: false,
      provider: 'none',
      error:
        'No SMS provider is configured. Set one up in lib/sms.ts (T8 launch item).',
    }
  },
}

/**
 * In development, write the code to the server log instead of sending it, so
 * the flow is exercisable without a provider. Never selected in production.
 */
const devConsole: SmsProvider = {
  name: 'dev-console',
  async send(to, body): Promise<SmsResult> {
    console.log(`[sms:dev] to=${to} :: ${body}`)
    return { ok: true, provider: 'dev-console' }
  },
}

export function getSmsProvider(): SmsProvider {
  // When a real provider lands, select it here from env.
  if (process.env.NODE_ENV === 'production') return notConfigured
  return devConsole
}
