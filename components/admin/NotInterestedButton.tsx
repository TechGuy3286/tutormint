'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// "Not interested" on Follow-ups (owner, 21 Oct 2026): moves the member to the
// hidden "Not interested" group; "Undo" puts them back. Nothing is deleted —
// who and when are recorded (migration 191, admin_audit_log).

export default function NotInterestedButton({
  memberId,
  marked,
  onDone,
}: {
  memberId: string
  /** Already marked — the button undoes the mark. */
  marked: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  if (readOnly) return null

  const run = async () => {
    if (!marked) {
      const yes = await confirm({
        title: 'Mark as not interested?',
        body: 'They move to the hidden "Not interested" group and leave this list. You can undo it there.',
        confirmLabel: 'Not interested',
        cancelLabel: 'Cancel',
        destructive: false,
      })
      if (!yes) return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/follow-ups/not-interested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, undo: marked }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(marked ? 'Back on Follow-ups.' : 'Moved to Not interested.')
    onDone?.()
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex min-h-[32px] items-center gap-1 self-start text-[11px] font-bold text-gray-600 underline-offset-2 hover:text-tm-navy hover:underline disabled:opacity-50"
    >
      {marked ? <Undo2 aria-hidden size={12} /> : <EyeOff aria-hidden size={12} />}
      {busy ? 'Saving…' : marked ? 'Undo not interested' : 'Not interested'}
    </button>
  )
}
