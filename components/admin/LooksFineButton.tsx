'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { LOOKS_FINE_LABEL, type BlankItem } from '@/lib/photoBlankCore'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'

// "Looks fine" on a blank-photo flag (owner, 10 Nov 2026): clears the flag of
// that photo or selfie (who and when are recorded), with a 10-second Undo. The
// file is never flagged again. Shared by the People card and the Review card.

export default function LooksFineButton({ memberId, item, label }: { memberId: string; item: BlankItem; label?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const post = (body: Record<string, unknown>) =>
    adminFetch<{ error?: string; ids?: string[] }>('/api/admin/photos/looks-fine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const undo = async (ids: string[]) => {
    const { ok, data } = await post({ action: 'undo', memberId, item, ids })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Undone — the photo is flagged again.')
    router.refresh()
  }

  const clear = async () => {
    if (busy) return
    setBusy(true)
    const { ok, data } = await post({ action: 'clear', memberId, item })
    setBusy(false)
    if (!ok || !data?.ids?.length) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    const ids = data.ids
    toast.success('Marked as looks fine — the flag is cleared.', { label: 'Undo', onClick: () => void undo(ids), ms: UNDO_MS })
    router.refresh()
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void clear()}
      className="inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-lg border border-tm-green-deep bg-white px-2 font-bold text-tm-green-deep disabled:opacity-50"
    >
      <Check aria-hidden size={12} /> {label ?? LOOKS_FINE_LABEL}
    </button>
  )
}
