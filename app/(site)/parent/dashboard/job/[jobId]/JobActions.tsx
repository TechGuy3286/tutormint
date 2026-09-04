'use client'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Edit and close, on the parent's own job.
//
// Closing asks for confirmation because it is not reversible from the UI and
// it notifies every applicant. Only an open job can be edited: changing the
// subject under people who have already applied would waste their quota on a
// job they never chose.

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
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status !== 'open') {
    return (
      <p className="rounded-xl bg-tm-bg p-3 text-[11px] text-gray-500">
        This job is {status === 'hired' ? 'filled' : 'closed'} and no longer accepts applications.
        It stays here for your records.
      </p>
    )
  }

  const close = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/parent/jobs/close', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not close the job.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close the job.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-2 pt-1">
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      {confirming ? (
        <div className="space-y-2 rounded-xl bg-tm-bg p-3">
          <p className="text-[11px] leading-relaxed text-slate-700">
            Closing tells everyone who applied that the job is gone, and it cannot be reopened.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white"
            >
              {busy ? 'Closing…' : 'Yes, close it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
            >
              Keep open
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/parent/dashboard/job/${jobRef}/edit`}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
          >
            Close job
          </button>
        </div>
      )}
    </div>
  )
}
