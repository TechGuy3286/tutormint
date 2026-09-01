// lib/sms/provider.ts
//
// The SMS contract.
//
// Same shape as lib/payments/provider.ts and lib/notify/channel.ts, for the
// same reason: isConfigured() is asked first, so a deploy with no credentials
// degrades to a stated failure rather than an exception in the middle of
// somebody's verification.
//
// The one rule this interface exists to enforce: send() NEVER returns ok:true
// unless a message was actually handed to a carrier. Telling a member "code
// sent" when nothing was sent leaves them waiting on a screen for a message
// that does not exist, and there is no error anywhere to explain it.

export type SmsResult =
  | { ok: true; provider: string; id?: string | null }
  | { ok: false; provider: string; error: string }

export interface SmsProvider {
  readonly name: string
  isConfigured(): boolean
  send(to: string, body: string): Promise<SmsResult>
}
