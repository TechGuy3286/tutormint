'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useCanApprove } from '@/components/admin/ReadOnly'

// "Merge" and "Not a duplicate" beside a "Possible duplicate" (owner, 26 Oct
// 2026). Owner only — the routes refuse everyone else. "Not a duplicate" hides
// the warning for that pair for good and is logged.

export default function DuplicateActions({ aId, bId, reason }: { aId: string; bId: string; reason: string | null }) {
  const isOwner = useCanApprove()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  if (!isOwner) return null

  async function notDuplicate() {
    const ok = await confirm({
      title: 'Not a duplicate?',
      body: 'The "Possible duplicate" warning for these two accounts will be hidden for good.',
      confirmLabel: 'Not a duplicate',
    })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/members/duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', aId, bId, reason }),
    })
    setBusy(false)
    if (!done) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success('Marked as not a duplicate.')
    router.refresh()
  }

  return (
    <span className="ms-1 inline-flex gap-1 align-middle" data-duplicate-actions="">
      <Link
        href={`/admin/users/merge?a=${aId}&b=${bId}`}
        className="rounded-md border border-tm-red/40 bg-white px-1.5 py-0.5 text-[10px] font-bold text-tm-red no-underline hover:border-tm-red"
      >
        Merge
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={() => void notDuplicate()}
        className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700 hover:border-tm-navy disabled:opacity-50"
      >
        Not a duplicate
      </button>
    </span>
  )
}
