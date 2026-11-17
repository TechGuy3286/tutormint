'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'

// "Reopen" on a rejected bank-transfer receipt (owner, 17 Nov 2026 — PR-03).
// Owner only (the server checks, with a fresh password); a reason is required.
// The receipt goes back to "Waiting for approval".

export default function ReopenPayment({ paymentId }: { paymentId: string }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  if (readOnly) return null

  const reopen = async () => {
    const reason = window.prompt('Why are you reopening this receipt? (kept in the audit log)')
    if (reason == null) return
    if (reason.trim().length < 3) {
      toast.error('Give a short reason.')
      return
    }
    setBusy(true)
    const r = await adminFetch<{ error?: string }>('/api/admin/payments/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, reason: reason.trim() }),
    })
    setBusy(false)
    if (r.ok) {
      toast.success('Reopened. The receipt is waiting for approval again.')
      router.refresh()
    } else toast.error(r.data?.error ?? 'Could not reopen this receipt.')
  }

  return (
    <button
      type="button"
      onClick={reopen}
      disabled={busy}
      className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
    >
      <RotateCcw aria-hidden size={14} />
      Reopen
    </button>
  )
}
