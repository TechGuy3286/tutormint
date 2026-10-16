// lib/notify/email.ts
//
// The email channel behind the DeliveryChannel interface. It no longer talks to
// Resend itself: every email goes through lib/email/send.ts (owner, 16 Oct
// 2026), which owns the limiter, retries, batching and the send log. This file
// only adapts that module to the channel shape the rest of lib/notify uses.

import type { DeliveryChannel, DeliveryResult, OutboundMessage } from './channel'
import { emailConfigured, sendOne } from '@/lib/email/send'

export { mailFrom } from '@/lib/email/send'

const emailChannel: DeliveryChannel = {
  id: 'email',
  isConfigured() {
    return emailConfigured()
  },
  async send(message: OutboundMessage & { template?: string }): Promise<DeliveryResult> {
    const r = await sendOne(message, { job: message.template })
    return r.ok ? { ok: true, id: r.id, channel: 'email' } : { ok: false, reason: r.reason, channel: 'email' }
  },
}

export function getEmailChannel(): DeliveryChannel {
  return emailChannel
}
