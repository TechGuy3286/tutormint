'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Approve or reject one claim (owner, 15 Oct 2026): one click, optional reason.
// Rendered only for the Owner and Admin, and never on the decider's own claim;
// the server checks both again.

export default function ClaimDecision({ claimId }: { claimId: string }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function decide(decision: 'approve' | 'reject') {
    if (busy) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; status?: string }>('/api/admin/staff-signups/claims/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId, decision, reason: reason.trim() || null }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(data?.status === 'approved' ? 'Approved. Credit given.' : 'Rejected. No credit given.')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="Reason (optional)"
        aria-label="Reason (optional)"
        className="min-h-[40px] min-w-0 flex-1 rounded-xl border border-gray-200 bg-tm-bg px-2 text-xs"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('approve')}
        className="min-h-[40px] rounded-xl bg-tm-green-deep px-3 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('reject')}
        className="min-h-[40px] rounded-xl border border-tm-red px-3 text-xs font-bold text-tm-red hover:bg-tm-tint-red disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  )
}
