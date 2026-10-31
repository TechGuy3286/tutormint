'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ClipboardCheck } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// Staff actions on a bank-transfer receipt waiting for a decision (owner,
// 31 Oct 2026):
//   • "Mark checked" — tells the Owner a person has looked at it (Admin and
//     Backend Support). Nothing activates.
//   • "Approve (bank credit matched)" — Backend Support only. The SERVER
//     decides (lib/staffReceiptCore): only a receipt matched to a real, unlinked
//     bank credit in the fee range, within 48 hours, from the member's own name,
//     and not their own referral. Otherwise it answers why, and the Owner decides.

export default function StaffReceiptActions({
  paymentId,
  payerName,
  checkedByName,
  canCheck,
  staffMayApprove,
}: {
  paymentId: string
  payerName: string
  checkedByName: string | null
  canCheck: boolean
  staffMayApprove: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/receipt-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId }),
    })
    setBusy(false)
    if (ok) {
      toast.success('Marked as checked for the Owner.')
      router.refresh()
    } else toast.error(data?.error ?? 'That did not save. Please try again.')
  }

  const approve = async () => {
    const go = await confirm({
      title: 'Approve this bank transfer?',
      body: `Only allowed when a matching bank credit is in Finance. Approving activates it for ${payerName}. The Owner sees every staff approval and can undo it.`,
      confirmLabel: 'Approve',
    })
    if (!go) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, action: 'approve' }),
    })
    setBusy(false)
    if (ok) {
      toast.success('Approved. The bank credit is linked and the Owner will see it in the daily list.')
      router.refresh()
    } else toast.error(data?.error ?? 'This one stays with the Owner.')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {checkedByName ? (
        <span className="text-[11px] font-bold text-tm-green-deep">Checked by {checkedByName}</span>
      ) : (
        canCheck && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void check()}
            className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-60"
          >
            <ClipboardCheck aria-hidden size={14} />
            Mark checked
          </button>
        )
      )}
      {staffMayApprove && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void approve()}
          className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
        >
          <Check aria-hidden size={14} />
          Approve (bank credit matched)
        </button>
      )}
    </div>
  )
}
