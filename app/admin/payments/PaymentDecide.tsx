'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'

// Approve / reject a bank-or-wallet transfer that is waiting for approval
// (PR98 §4). Approval activates the plan via the audited admin path; rejection
// needs a reason the member reads. Both go through adminFetch, so the
// fresh-password prompt is handled in one place.

export default function PaymentDecide({
  paymentId,
  payerName,
}: {
  paymentId: string
  payerName: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const readOnly = useAdminReadOnly()

  const approve = async () => {
    const ok = await confirm({
      title: 'Approve this transfer?',
      body: `This activates the plan for ${payerName} and notifies them. It cannot be undone.`,
      confirmLabel: 'Approve',
    })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/payments/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, action: 'approve' }),
    })
    setBusy(false)
    if (done) {
      toast.success('Transfer approved — the plan is now active.')
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not approve this transfer.')
    }
  }

  const reject = async () => {
    const reason = window.prompt('Why are you rejecting this transfer? The member will see this.')
    if (reason == null) return
    if (reason.trim().length < 3) {
      toast.error('Give a short reason the member can read.')
      return
    }
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/payments/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, action: 'reject', reason: reason.trim() }),
    })
    setBusy(false)
    if (done) {
      toast.success('Transfer rejected — the member has been told.')
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not reject this transfer.')
    }
  }

  if (readOnly) return null
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={approve}
        disabled={busy}
        className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
      >
        <Check aria-hidden size={14} />
        Approve
      </button>
      <button
        type="button"
        onClick={reject}
        disabled={busy}
        className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-tm-red/40 px-4 text-xs font-bold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
      >
        <X aria-hidden size={14} />
        Reject
      </button>
    </div>
  )
}
