// lib/notify/channel.ts
//
// The delivery contract. Email has a real implementation; WhatsApp has a stub
// that reports itself unconfigured, and both sit behind the same interface so
// that adding WhatsApp later is a file, not a refactor of every caller.
//
// The shape mirrors lib/payments/provider.ts on purpose: isConfigured() first,
// so a deploy missing its credentials degrades to "not sent, and said so"
// rather than throwing inside whatever business action triggered it. Nobody
// should fail to get hired because an email provider is down.

export type ChannelId = 'email' | 'whatsapp'

export type OutboundMessage = {
  /** Where it goes. An email address, or an MSISDN for WhatsApp. */
  to: string
  /** Subject line. WhatsApp ignores it. */
  subject: string
  /** Plain text — always present, and the only thing WhatsApp sends. */
  text: string
  /** HTML body for channels that render it. */
  html?: string
}

export type DeliveryResult =
  | { ok: true; id: string | null; channel: ChannelId }
  | { ok: false; reason: string; channel: ChannelId }

export interface DeliveryChannel {
  readonly id: ChannelId
  /** False when the credentials are absent. An unconfigured channel is skipped. */
  isConfigured(): boolean
  send(message: OutboundMessage): Promise<DeliveryResult>
}
