'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { OWNER_ONLY_LINE, useCanApprove } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// Approve / Reject on one pending review (owner, 27 Oct 2026). The Owner's
// alone — everyone else sees the view-only line, and the route refuses them.

export default function ReviewDecision({ reviewId }: { reviewId: string }) {
  const canApprove = useCanApprove()
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')

  if (!canApprove) return <p className="text-[11px] font-semibold text-gray-500">{OWNER_ONLY_LINE}</p>

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject') {
      const ok = await confirm({ title: 'Reject this review?', body: 'It will not appear on the tutor’s profile.', confirmLabel: 'Reject', destructive: true })
      if (!ok) return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/reviews/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, decision, reason: reason.trim() || null }),
    })
    setBusy(false)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(decision === 'approve' ? 'Approved. It is now on the tutor’s profile.' : 'Rejected. It will not be shown.')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 300))}
        placeholder="Note (optional)"
        aria-label="Note (optional)"
        className="min-h-[40px] min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-tm-navy"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('approve')}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
      >
        <Check aria-hidden size={14} />
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('reject')}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-tm-red px-4 text-xs font-bold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
      >
        <X aria-hidden size={14} />
        Reject
      </button>
    </div>
  )
}
