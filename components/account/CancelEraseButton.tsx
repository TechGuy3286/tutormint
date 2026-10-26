'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { useToast } from '@/components/ui/Toast'

// "Cancel" on the dashboard banner while the account is set to be deleted
// (owner, 27 Oct 2026). /api/account/delete { action: 'cancel' }.

export default function CancelEraseButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const cancel = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) toast.error(j.error ?? 'That did not go through. Please try again.')
      else {
        toast.success('Deletion cancelled. Your account stays.')
        router.refresh()
      }
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    }
    setBusy(false)
  }
  return (
    <button type="button" onClick={() => void cancel()} disabled={busy} className="min-h-[36px] rounded-lg border border-tm-red/40 bg-white px-3 text-xs font-extrabold text-tm-red underline-offset-2 hover:underline disabled:opacity-60">
      {busy ? 'Cancelling…' : 'Cancel'}
    </button>
  )
}
