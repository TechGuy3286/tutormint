// lib/notify/whatsapp.ts
//
// WhatsApp delivery — the interface, not the implementation.
//
// This is deliberately a stub. WhatsApp Business messaging requires a Meta app,
// a verified business, an approved sender number and pre-approved message
// templates for anything outside a 24-hour customer-service window; every one
// of those is an account-level decision, not a coding task, and none of them is
// done. Writing a speculative Cloud API client now would mean shipping code
// nobody can run and nobody can test.
//
// What is worth having today is the seam. deliver() already asks every channel
// whether it is configured, so the day the Meta account exists this file gets a
// body and no caller changes.
//
// Post-launch. Tracked in CLAUDE.md under Business rules (T-3 expiry reminder
// "via email + WhatsApp").

import type { DeliveryChannel, DeliveryResult, OutboundMessage } from './channel'

export const whatsappChannel: DeliveryChannel = {
  id: 'whatsapp',

  isConfigured() {
    // Never true yet. When the Meta app exists this becomes a check for
    // WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, and send() posts to
    // the Cloud API using an approved template.
    return false
  },

  async send(_message: OutboundMessage): Promise<DeliveryResult> {
    return {
      ok: false,
      reason: 'WhatsApp delivery is not configured (post-launch)',
      channel: 'whatsapp',
    }
  },
}
