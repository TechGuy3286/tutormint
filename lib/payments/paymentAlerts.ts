import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { PAYMENT_ALERTS_KEY, parseAlertEmails } from '@/lib/payments/alertEmailsCore'
import { formatName } from '@/lib/formatName'
import { bellStaff, ownerEmail } from '@/lib/staffAlerts'
import { SCREEN_ACCESS } from '@/lib/adminAccessCore'

export { PAYMENT_ALERTS_KEY, parseAlertEmails }

// Staff alerts for payments and documents (PR106-H1 §2; owner, 27 Oct 2026).
//
//   • Every alert goes to the in-app BELL of the staff whose role opens its
//     screen (lib/staffAlerts).
//   • "New payment received" is no longer emailed to anyone.
//   • "Bank transfer waiting for approval" is emailed to the OWNER ACCOUNT's own
//     address only (read from the Owner's profile, never written in code).
//   • The other alert emails are off by default; the Owner can switch each on in
//     Notification settings, and then it goes to the Owner's address only.
//
// NEVER includes a CNIC number, phone, card detail or document image — member
// name, role, what was bought, amount, provider and PKT time only. No address
// is ever logged.

/** Where an alert email goes: the Owner account's own address, or nobody. */
export async function paymentAlertEmails(): Promise<string[]> {
  const e = await ownerEmail()
  return e ? [e] : []
}

function nowPkt(): string {
  return new Date().toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

async function emailOwner(input: Parameters<typeof deliverEmail>[1], tag: string): Promise<void> {
  for (const email of await paymentAlertEmails()) {
    const r = await deliverEmail({ email }, input)
    if (!r.ok) console.info(`[${tag}] email not sent: ${r.reason}`)
  }
}

/** One alert per confirmed payment (the caller guarantees it runs once). Bell
 *  only: the email is switched off by default (Notification settings). */
export async function sendPaymentAlert(input: { memberName: string; role: string; what: string; amountPkr: number; via?: string }): Promise<void> {
  const name = input.memberName || 'A member'
  await bellStaff(SCREEN_ACCESS.payments, {
    title: `Payment received: ${name}`,
    body: `${input.what}${input.via ? ` via ${input.via}` : ''}`,
    href: '/admin/payments',
  }).catch(() => 0)
  await emailOwner(
    { id: 'payment_alert', memberName: name, role: input.role, what: input.what, amountPkr: input.amountPkr, whenPkt: nowPkt(), via: input.via },
    'payment-alert',
  )
}

/** A bank transfer receipt waits for approval: the bell for the staff who work
 *  the Payments queue, and the email to the Owner's own address. */
export async function sendBankTransferPending(input: { memberName: string; role: string; amountPkr: number }): Promise<void> {
  const name = input.memberName || 'A member'
  await bellStaff(SCREEN_ACCESS.paymentsApprove, {
    title: `Bank transfer waiting for approval: ${name}`,
    body: 'A receipt was uploaded. Open Payments to review it.',
    href: '/admin/payments?filter=unpaid',
  }).catch(() => 0)
  await emailOwner({ id: 'bank_transfer_pending', memberName: name, role: input.role, amountPkr: input.amountPkr }, 'bank-transfer-alert')
}

/** A tutor re-uploaded a previously rejected document (PR106-H4 §2.7). */
export async function sendReuploadAlert(input: { memberName: string; memberId: string }): Promise<void> {
  const name = input.memberName || 'A member'
  await bellStaff(SCREEN_ACCESS.tutors, { title: `Documents re-uploaded: ${name}`, body: 'Waiting for review.', href: `/admin/users/${input.memberId}` }).catch(() => 0)
  await emailOwner({ id: 'documents_reuploaded', memberName: name, href: `/admin/users/${input.memberId}` }, 'reupload-alert')
}

/** A member tried to save a CNIC already on another account (PR106-H4 §3.8).
 *  NEVER contains a CNIC number — a link to the member only. */
export async function sendDuplicateCnicAlert(input: { memberId: string }): Promise<void> {
  const admin = createAdminClient()
  const { data } = admin ? await admin.from('profiles').select('full_name').eq('id', input.memberId).maybeSingle() : { data: null }
  const memberName = formatName(data?.full_name as string | null) || 'A member'
  await bellStaff(SCREEN_ACCESS.tutors, { title: `CNIC already on another account: ${memberName}`, body: 'Check the member.', href: `/admin/users/${input.memberId}` }).catch(() => 0)
  await emailOwner({ id: 'duplicate_cnic', memberName, href: `/admin/users/${input.memberId}` }, 'duplicate-cnic-alert')
}
