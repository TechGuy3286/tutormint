'use client'

// "This member has already paid this fee" (owner, 27 Oct 2026). Shown under the
// message in "Link to member" / "Record a bank payment": the member's existing
// fee payment, and ONE way on —
//   • that payment has no bank credit yet → "Link this credit to that payment";
//   • it already has one (or it was paid through PayPro) → "Mark as duplicate —
//     refund due", which creates a Refund due item on Finance and the member's
//     page until it is marked refunded.
// Owner only: the server refuses everyone else and asks for the password.

import { useState } from 'react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import type { ExistingFee } from '@/lib/feeMatchCore'

const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const DANGER =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60'

export default function AlreadyPaidOptions({
  existing,
  option,
  transferId,
  memberId,
  memberName,
  creditAmountPkr,
  onDone,
}: {
  existing: ExistingFee
  option: 'link_existing' | 'refund_due'
  transferId: string
  memberId: string
  memberName: string
  creditAmountPkr: number
  onDone: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    const { ok, data } =
      option === 'link_existing'
        ? await adminFetch<{ error?: string; rounding?: number }>('/api/admin/payments/bank-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'link_existing', transferId, paymentId: existing.paymentId }),
          })
        : await adminFetch<{ error?: string; rounding?: number }>('/api/admin/payments/refund-due', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'due', transferId, memberId, paymentId: existing.paymentId, note: `Duplicate of ${existing.ref}` }),
          })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(
      option === 'link_existing'
        ? `Linked to ${existing.ref}.${data?.rounding && data.rounding > 0 ? ` Rs ${data.rounding} recorded as rounding.` : ''}`
        : `Refund due recorded: ${pkr(creditAmountPkr)} for ${memberName}.`,
    )
    onDone()
  }

  return (
    <div className="space-y-2 rounded-xl border border-tm-gold/40 bg-tm-tint-gold p-3" data-already-paid="">
      <p className="text-xs font-bold text-tm-gold-ink">{memberName} has already paid this fee:</p>
      <p className="text-[11px] text-slate-800">
        <span className="font-mono font-bold">{existing.ref}</span> · {pkr(existing.amountPkr)}
        {existing.approvedAt ? ` · approved ${formatDate(existing.approvedAt)}` : ''} ·{' '}
        {existing.provider === 'manual' ? 'bank transfer' : 'PayPro'} ·{' '}
        {existing.hasCredit ? 'already has its bank credit' : 'no bank credit linked yet'}
      </p>
      <button type="button" disabled={busy} onClick={() => void go()} className={option === 'link_existing' ? BUTTON : DANGER}>
        {busy ? 'Saving…' : option === 'link_existing' ? 'Link this credit to that payment' : 'Mark as duplicate — refund due'}
      </button>
      {option === 'refund_due' && (
        <p className="text-[11px] text-slate-700">This adds a Refund due item to Finance and to the member&rsquo;s page until you mark it refunded.</p>
      )}
    </div>
  )
}
