'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatDate } from '@/lib/datetime'
import { ROLE_LABEL, type AdminRole } from '@/lib/adminAccessCore'
import { restoreRoleFor } from '@/lib/formerStaffCore'

// Former staff (owner, 24 Oct 2026): a label for everyone, and the Owner's
// "Restore staff access" (the route refuses everyone else). Restoring brings
// back the role they held and their staff link; cities and tuitions are not
// handed back.
export default function RestoreStaffCard({
  memberId,
  formerAt,
  formerRole,
  canRestore,
}: {
  memberId: string
  formerAt: string
  formerRole: string | null
  canRestore: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const role = ROLE_LABEL[restoreRoleFor(formerRole) as AdminRole]

  async function restore() {
    const yes = await confirm({
      title: 'Restore staff access?',
      body: `They get the ${role} role and their staff link back. Cities and tuitions are not handed back.`,
      confirmLabel: 'Restore access',
      destructive: false,
    })
    if (!yes) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; role?: string }>('/api/admin/members/restore-staff', {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`Staff access restored as ${role}.`)
    router.refresh()
  }

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-black text-tm-navy">Former staff</p>
        <p className="text-xs text-gray-600">
          Staff access removed on {formatDate(formerAt)}{formerRole ? ` (was ${ROLE_LABEL[formerRole as AdminRole] ?? formerRole})` : ''}. Past credits, tuitions and history are kept.
        </p>
      </div>
      {canRestore && (
        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy}
          className="ms-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-tm-navy px-3 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-60"
        >
          <RotateCcw aria-hidden size={14} /> Restore staff access
        </button>
      )}
    </section>
  )
}
