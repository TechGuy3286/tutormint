// lib/notify/index.ts
//
// The one way an email leaves TutorMint.
//
// Everything routes through deliverEmail() (one email) or deliverEmailBulk() (a
// list — one batch request per 100, lib/email/send sendBulk), which decide three
// things in this order and stop at the first "no":
//
//   1. Does the template respect the opt-out, and has this person opted out?
//   2. Is there an address to send to at all?
//   3. Did the channel accept it?
//
// It never throws. A caller is always in the middle of something more important
// than an email -- hiring a tutor, approving a payment -- and a delivery
// failure must not roll that back. Failures are logged with the template id and
// the reason, so a silent outage still leaves a trail.

import { mayEmailAddress } from '@/lib/emailConfirmCore'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailChannel } from './email'
import { sendBulk, type EmailMessage } from '@/lib/email/send'
import { whatsappChannel } from './whatsapp'
import { render, type TemplateInput } from './templates'
import type { DeliveryResult } from './channel'
import { formatName } from '@/lib/formatName'
import { tuitionEmailBlock } from './tuitionEmailCore'

const HELD_FOR_SUMMARY = 'held for the daily summary'

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
  const prepared = await prepareEmail(to, input)
  if (!prepared.ok) return prepared

  const channel = getEmailChannel()
  const result = await channel.send(prepared.message)

  // Never the address in a log line (owner, 27 Oct 2026).
  if (!result.ok) console.info(`[notify] ${input.id} not sent: ${result.reason}`)
  return result
}

/**
 * Send one templated email to each of many people (owner, 16 Oct 2026). Every
 * cron and fan-out that emails a list goes through here, so the list becomes
 * one batch request per 100 emails (lib/email/send sendBulk), paced and
 * retried, instead of one request per person. The decisions per recipient
 * (opt-out, unconfirmed address, no-mailbox address) are exactly deliverEmail's.
 *
 * Returns one result per item, in order. Never throws.
 */
export async function deliverEmailBulk(
  items: readonly { to: Recipient; input: TemplateInput }[],
  job: string,
): Promise<(DeliveryResult | { ok: false; reason: string; channel: 'email' })[]> {
  const out: (DeliveryResult | { ok: false; reason: string; channel: 'email' })[] = new Array(items.length)
  const prepared: Awaited<ReturnType<typeof prepareEmail>>[] = new Array(items.length)
  // Recipient lookups ten at a time (database reads, not email requests).
  for (let i = 0; i < items.length; i += 10) {
    const part = await Promise.all(
      items.slice(i, i + 10).map((it) =>
        prepareEmail(it.to, it.input).catch((e) => ({ ok: false as const, reason: String(e), channel: 'email' as const })),
      ),
    )
    part.forEach((p, k) => (prepared[i + k] = p))
  }
  const sendIdx: number[] = []
  prepared.forEach((p, i) => {
    if (p.ok) sendIdx.push(i)
    else out[i] = p
  })
  const { results } = await sendBulk(
    sendIdx.map((i) => (prepared[i] as { ok: true; message: EmailMessage }).message),
    { job },
  )
  sendIdx.forEach((i, k) => {
    const r = results[k]
    out[i] = r.ok ? { ok: true, id: r.id, channel: 'email' } : { ok: false, reason: r.reason, channel: 'email' }
  })
  return out
}

/**
 * Who gets this email, and what it says — or why nobody does. The rules every
 * send follows, single or bulk.
 */
async function prepareEmail(
  to: Recipient,
  input: TemplateInput,
): Promise<{ ok: true; message: EmailMessage } | { ok: false; reason: string; channel: 'email' }> {
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
      .select('email, email_opt_out, email_pending_confirm, role, is_team_account, is_test_name, hidden_from_public, is_seed')
      .eq('id', to.userId)
      .maybeSingle()

    if (!profile) return { ok: false, reason: 'no profile row', channel: 'email' }

    // No wasted tuition emails (owner, 27 Oct 2026): never to the team account,
    // staff, test accounts or placeholder addresses (lib/notify/tuitionEmailCore).
    const blocked = tuitionEmailBlock(input.id, profile as Parameters<typeof tuitionEmailBlock>[1])
    if (blocked) return { ok: false, reason: `tuition email not sent: ${blocked}`, channel: 'email' }

    // An address that is still waiting for its confirmation link (owner, 13 Oct
    // 2026) receives the confirmation email and nothing else: a mistyped
    // address must not be sent somebody else's receipts and reminders.
    if (!mayEmailAddress({ email: profile.email as string | null, pending: !!profile.email_pending_confirm }, input.id)) {
      return { ok: false, reason: 'email address not confirmed yet', channel: 'email' }
    }

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

  return {
    ok: true,
    message: { to: address, subject: message.subject, text: message.text, html: message.html, template: input.id },
  }
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
      name: formatName(profile.full_name as string | null) || 'there',
      count: params.count,
      from: params.from,
    },
  )

  // Held for the daily summary counts as handled (owner, 27 Oct 2026): the
  // summary carries it, so the hourly digest is not held again.
  if (!result.ok && result.reason !== HELD_FOR_SUMMARY) return false

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
