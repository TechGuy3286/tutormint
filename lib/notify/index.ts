// lib/notify/index.ts
//
// The one way an email leaves TutorMint.
//
// Everything routes through deliverEmail(), which decides three things in this
// order and stops at the first "no":
//
//   1. Does the template respect the opt-out, and has this person opted out?
//   2. Is there an address to send to at all?
//   3. Did the channel accept it?
//
// It never throws. A caller is always in the middle of something more important
// than an email -- hiring a tutor, approving a payment -- and a delivery
// failure must not roll that back. Failures are logged with the template id and
// the reason, so a silent outage still leaves a trail.

import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailChannel } from './email'
import { whatsappChannel } from './whatsapp'
import { render, type TemplateInput } from './templates'
import type { DeliveryResult } from './channel'

export { render, type TemplateInput } from './templates'
export type { DeliveryChannel, OutboundMessage, DeliveryResult } from './channel'

type Recipient =
  | { userId: string; email?: undefined; name?: undefined }
  | { userId?: undefined; email: string; name?: string }

/**
 * Send one templated email.
 *
 * Pass a userId and the address, name and opt-out state are looked up; pass an
 * email directly for the one case where there is no profile row yet (the
 * welcome email is sent from the signup path, which may run before the trigger
 * that creates the profile has been observed).
 */
export async function deliverEmail(
  to: Recipient,
  input: TemplateInput,
): Promise<DeliveryResult | { ok: false; reason: string; channel: 'email' }> {
  const message = render(input)

  let address = to.email ?? null

  if (to.userId) {
    const admin = createAdminClient()
    if (!admin) {
      console.error('[notify] no service-role client; cannot resolve recipient for', input.id)
      return { ok: false, reason: 'service-role client unavailable', channel: 'email' }
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('email, email_opt_out')
      .eq('id', to.userId)
      .maybeSingle()

    if (!profile) return { ok: false, reason: 'no profile row', channel: 'email' }

    // Imported tutors have a synthetic address at users.tutormint.org that no
    // mailbox exists behind. Sending there is not a delivery failure we would
    // ever find out about -- it is a bounce nobody reads -- so skip it and say
    // so. They are reached over WhatsApp, which is how the import works.
    if (profile.email && String(profile.email).endsWith('@users.tutormint.org')) {
      return { ok: false, reason: 'synthetic import address, no mailbox', channel: 'email' }
    }

    if (!message.essential && profile.email_opt_out) {
      return { ok: false, reason: 'recipient opted out of non-essential email', channel: 'email' }
    }

    address = (profile.email as string | null) ?? null
  }

  if (!address) return { ok: false, reason: 'no email address on file', channel: 'email' }

  const channel = getEmailChannel()
  const result = await channel.send({
    to: address,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  if (!result.ok) console.error(`[notify] ${input.id} to ${address} failed: ${result.reason}`)
  return result
}

/**
 * The message digest, throttled to one per hour per person.
 *
 * The throttle is a timestamp on the profile rather than a timer in the
 * process: on Vercel each lambda has its own memory, so an in-process guard
 * would allow one email per hour per instance, which is not the promise made.
 *
 * Returns true when an email was actually sent.
 */
export async function deliverMessageDigest(params: {
  userId: string
  count: number
  from: string[]
}): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, last_message_digest_at')
    .eq('id', params.userId)
    .maybeSingle()

  if (!profile) return false

  const last = profile.last_message_digest_at
    ? new Date(profile.last_message_digest_at as string).getTime()
    : 0
  if (Date.now() - last < 60 * 60 * 1000) return false

  const result = await deliverEmail(
    { userId: params.userId },
    {
      id: 'message_digest',
      name: (profile.full_name as string) ?? 'there',
      count: params.count,
      from: params.from,
    },
  )

  if (!result.ok) return false

  // Stamped only after a send actually succeeded, so a provider outage does
  // not silently consume someone's hourly slot.
  await admin
    .from('profiles')
    .update({ last_message_digest_at: new Date().toISOString() })
    .eq('id', params.userId)

  return true
}

/**
 * WhatsApp, once it exists. Present so callers can be written now; today it
 * reports itself unconfigured and does nothing.
 */
export async function deliverWhatsApp(to: string, text: string): Promise<DeliveryResult> {
  if (!whatsappChannel.isConfigured()) {
    return { ok: false, reason: 'WhatsApp delivery is not configured', channel: 'whatsapp' }
  }
  return whatsappChannel.send({ to, subject: '', text })
}
