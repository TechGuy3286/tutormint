'use client'

// "Mark as refunded" on a Refund due (owner, 27 Oct 2026). Owner only — the
// server refuses everyone else and asks for the password again.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'

export default function MarkRefundedButton({ id }: { id: string }) {
  const canApprove = useCanApprove()
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!canApprove) return null
  const go = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/refund-due', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refunded', id }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success('Marked as refunded.')
    router.refresh()
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void go()}
      className="inline-flex min-h-[36px] items-center rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
    >
      {busy ? 'Saving…' : 'Mark as refunded'}
    </button>
  )
}
