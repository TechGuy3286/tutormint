'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Owner only: undo one staff approval (owner, 31 Oct 2026). Asks for a reason;
// the server asks for the password again when it is stale.

export default function StaffApprovalUndo({ paymentId }: { paymentId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const undo = async () => {
    const reason = window.prompt('Why are you undoing this approval? (kept in the audit log)')
    if (reason == null) return
    if (reason.trim().length < 3) {
      toast.error('Write a short reason for the record.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/staff-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, reason: reason.trim() }),
    })
    setBusy(false)
    if (ok) {
      toast.success('Undone. The payment is waiting again; the badge and the revenue entry are removed.')
      router.refresh()
    } else toast.error(data?.error ?? 'That did not save. Please try again.')
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void undo()}
      className="gap-1.5 inline-flex min-h-[40px] items-center rounded-xl border border-tm-red px-3 text-xs font-bold text-tm-red disabled:opacity-60"
    >
      <Undo2 aria-hidden size={13} />
      Undo
    </button>
  )
}
