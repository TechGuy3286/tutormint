import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { PAYMENT_ALERTS_KEY, parseAlertEmails } from '@/lib/payments/alertEmailsCore'
import { formatName } from '@/lib/formatName'

export { PAYMENT_ALERTS_KEY, parseAlertEmails }

// Staff alert emails for payments (PR106-H1 §2). Owner-sets one or more
// addresses in Admin → Payments → Payment settings; absent → the owner's own
// address, so alerts never silently go nowhere. Sent from activatePayment's
// FRESH-activation branch only (idempotent: a replayed PayPro callback returns
// alreadyActive and never reaches here), so exactly one alert per payment.
//
// NEVER includes a CNIC number, phone, card detail or document image — member
// name, role, what was bought, amount, provider and PKT time only.

const DEFAULT_ALERT = 'techguy3286@gmail.com'

export async function paymentAlertEmails(): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return [DEFAULT_ALERT]
  const { data } = await admin.from('app_settings').select('value').eq('key', PAYMENT_ALERTS_KEY).maybeSingle()
  const list = parseAlertEmails(data?.value as string | null)
  return list.length ? list : [DEFAULT_ALERT]
}

function nowPkt(): string {
  return new Date().toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/** One alert per confirmed payment (the caller guarantees it runs once). */
export async function sendPaymentAlert(input: { memberName: string; role: string; what: string; amountPkr: number }): Promise<void> {
  const to = await paymentAlertEmails()
  for (const email of to) {
    const r = await deliverEmail(
      { email },
      { id: 'payment_alert', memberName: input.memberName || 'A member', role: input.role, what: input.what, amountPkr: input.amountPkr, whenPkt: nowPkt() },
    )
    if (!r.ok) console.info('[payment-alert] not sent to', email, '-', r.reason)
  }
}

/** One alert when a bank transfer is submitted and awaits staff approval. */
export async function sendBankTransferPending(input: { memberName: string; role: string; amountPkr: number }): Promise<void> {
  const to = await paymentAlertEmails()
  for (const email of to) {
    const r = await deliverEmail(
      { email },
      { id: 'bank_transfer_pending', memberName: input.memberName || 'A member', role: input.role, amountPkr: input.amountPkr },
    )
    if (!r.ok) console.info('[bank-transfer-alert] not sent to', email, '-', r.reason)
  }
}

/** One alert when a tutor re-uploads a previously-rejected document and it is
 *  back in the Approval-needed queue (PR106-H4 §2.7). Never names the document
 *  contents — the member name and a link to their record only. */
export async function sendReuploadAlert(input: { memberName: string; memberId: string }): Promise<void> {
  const to = await paymentAlertEmails()
  for (const email of to) {
    const r = await deliverEmail(
      { email },
      { id: 'documents_reuploaded', memberName: input.memberName || 'A member', href: `/admin/users/${input.memberId}` },
    )
    if (!r.ok) console.info('[reupload-alert] not sent to', email, '-', r.reason)
  }
}

/** A staff alert when a member tries to save a CNIC already on another account
 *  (PR106-H4 §3.8). NEVER contains a CNIC number — a link to the member only. */
export async function sendDuplicateCnicAlert(input: { memberId: string }): Promise<void> {
  const admin = createAdminClient()
  const { data } = admin
    ? await admin.from('profiles').select('full_name').eq('id', input.memberId).maybeSingle()
    : { data: null }
  const memberName = formatName(data?.full_name as string | null) || 'A member'
  const to = await paymentAlertEmails()
  for (const email of to) {
    const r = await deliverEmail(
      { email },
      { id: 'duplicate_cnic', memberName, href: `/admin/users/${input.memberId}` },
    )
    if (!r.ok) console.info('[duplicate-cnic-alert] not sent to', email, '-', r.reason)
  }
}
