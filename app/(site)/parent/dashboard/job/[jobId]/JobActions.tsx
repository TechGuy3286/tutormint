'use client'
import { Lock, PencilLine } from 'lucide-react'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// Edit and close, on the parent's own job.
//
// Closing goes through the one shared confirm dialog (it is not reversible and
// it notifies every applicant) and reports the outcome as a toast. Only an open
// job can be edited: changing the subject under people who have already applied
// would waste their quota on a job they never chose.

export default function JobActions({
  jobId,
  jobRef,
  status,
}: {
  jobId: string
  jobRef: string
  status: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  if (status !== 'open') {
    return (
      <p className="rounded-xl bg-tm-bg p-3 text-[11px] text-gray-500">
        This job is {status === 'hired' ? 'filled' : 'closed'} and no longer accepts applications.
        It stays here for your records.
      </p>
    )
  }

  const close = async () => {
    const ok = await confirm({
      title: 'Close this tuition?',
      body: 'Closing tells everyone who applied that the job is gone, and it cannot be reopened.',
      confirmLabel: 'Close tuition',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/parent/jobs/close', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not close the job.')
      toast.success('Tuition closed.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the job.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1 sm:flex-row">
      <Link
        href={`/parent/dashboard/job/${jobRef}/edit`}
        className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
      >
        <PencilLine aria-hidden size={14} />
        Edit
      </Link>
      <button
        type="button"
        onClick={close}
        disabled={busy}
        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 disabled:opacity-60"
      >
        <Lock aria-hidden size={14} />
        {busy ? 'Closing…' : 'Close job'}
      </button>
    </div>
  )
}
