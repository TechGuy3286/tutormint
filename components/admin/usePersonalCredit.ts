'use client'

// "Not business (personal)" on a bank credit (owner, 10 Nov 2026): the one
// browser call used by the Finance board and the month lines. The server is
// Owner only; screens show the buttons only when useCanApprove() is true.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

export function usePersonalCredit() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const send = async (transferId: string, action: 'mark' | 'undo', note = ''): Promise<boolean> => {
    setBusy(transferId)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/settlement/personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'mark' ? { action, transferId, note } : { action, transferId }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return false
    }
    toast.success(action === 'mark' ? 'Marked as personal. It is left out of every total.' : 'Undone. The entry counts again.')
    router.refresh()
    return true
  }

  return { busy, send }
}
