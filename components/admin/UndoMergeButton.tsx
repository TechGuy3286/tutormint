'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useCanApprove } from '@/components/admin/ReadOnly'

// "Undo merge" (owner, 26 Oct 2026): every record the merge moved goes back
// exactly (the merge log on member_merges). Owner only, password asked again.

export default function UndoMergeButton({ mergeId }: { mergeId: string }) {
  const isOwner = useCanApprove()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  if (!isOwner) return null
  async function undo() {
    const ok = await confirm({ title: 'Undo this merge?', body: 'Everything the merge moved goes back to the account it came from.', confirmLabel: 'Undo merge' })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/members/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', mergeId }),
    })
    setBusy(false)
    if (!done) return toast.error(data?.error ?? 'The undo did not go through.')
    toast.success('Merge undone.')
    router.refresh()
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void undo()}
      className="inline-flex min-h-[36px] items-center rounded-lg border border-tm-red/40 bg-white px-2.5 text-[11px] font-bold text-tm-red hover:border-tm-red disabled:opacity-50"
    >
      {busy ? 'Undoing…' : 'Undo merge'}
    </button>
  )
}
