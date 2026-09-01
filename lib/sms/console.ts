// lib/sms/console.ts
//
// The development adapter: prints the message to the server log.
//
// It exists so the OTP flow is exercisable end to end without a carrier
// account. It reports ok:true because, in this environment, delivery did
// everything it can do — but the log line says CONSOLE, so nobody reading a
// terminal can mistake it for a real send.
//
// getSmsProvider() will never return this in production. That is enforced in
// index.ts and asserted again at server start in instrumentation.ts.

import type { SmsProvider, SmsResult } from './provider'

export const consoleProvider: SmsProvider = {
  name: 'console',

  isConfigured() {
    return true
  },

  async send(to: string, body: string): Promise<SmsResult> {
    console.log(`\n─── SMS (CONSOLE — no provider configured) ───\nTo: ${to}\n${body}\n──────────────────────────────────────────────\n`)
    return { ok: true, provider: 'console' }
  },
}
