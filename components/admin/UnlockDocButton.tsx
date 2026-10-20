'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Unlock } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// "Unlock for re-upload" (owner, 9 Oct 2026) on an approved, locked CNIC,
// selfie or profile picture. The member may then upload ONE new copy, which
// waits in the approval queue while the approved file stays on record. The
// Owner's alone (owner, 15 Oct 2026); the route refuses everyone else and
// audits who and when.
//
// Since 20 Oct 2026 the action lives in the document card's "Change ▾" menu
// (useUnlockDoc); UnlockedNote is the line shown while an unlock is open.

export function useUnlockDoc(memberId: string, item: 'cnic' | 'selfie' | 'photo', unlockOpen: boolean) {
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [open, setOpen] = useState(unlockOpen)
  const [busy, setBusy] = useState(false)
  const name = item === 'cnic' ? 'CNIC' : item === 'selfie' ? 'selfie' : 'profile picture'

  const run = async () => {
    const ok = await confirm({
      title: `Unlock this ${name}?`,
      body:
        item === 'photo'
          ? 'The tutor can change their profile picture once. The new photo goes back for your review.'
          : `The member can upload one new ${name}. It waits for approval while the approved one stays on record.`,
      confirmLabel: 'Unlock',
      destructive: false,
    })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/documents/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, item }),
    })
    setBusy(false)
    if (done) {
      setOpen(true)
      toast.success(`Unlocked. The member can upload a new ${name} once.`)
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not unlock that.')
    }
  }

  return { open, busy, run }
}

export function UnlockedNote() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-tm-navy">
      <Unlock aria-hidden size={12} /> Unlocked — waiting for the member&rsquo;s new upload.
    </p>
  )
}

/** The stand-alone button (kept for any screen without a Change menu). */
export default function UnlockDocButton({
  memberId,
  item,
  unlockOpen,
  canUnlock,
}: {
  memberId: string
  item: 'cnic' | 'selfie' | 'photo'
  unlockOpen: boolean
  canUnlock: boolean
}) {
  const readOnly = useAdminReadOnly()
  const ownerApproves = useCanApprove()
  const { open, busy, run } = useUnlockDoc(memberId, item, unlockOpen)
  if (open) return <UnlockedNote />
  if (!canUnlock || readOnly || !ownerApproves) return null
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-tm-navy/30 px-2.5 text-[11px] font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Unlock size={12} aria-hidden />}
      Unlock for re-upload
    </button>
  )
}
