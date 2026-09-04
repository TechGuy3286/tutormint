'use client'

import { Trash2 } from 'lucide-react'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// The tutor's own applications, with withdrawal.
//
// Withdrawing does not give the application slot back. That is the owner's
// rule and it is stated on the confirmation rather than left to be discovered
// after the fact -- it is the whole reason the rule exists, since otherwise a
// tutor could apply to everything and withdraw from what does not answer.

export type MyApplication = {
  id: string
  jobId: string
  jobTitle: string
  jobStatus: string
  status: 'applied' | 'shortlisted' | 'hired' | 'rejected'
  withdrawn: boolean
  createdAt: string
}

const LABEL: Record<MyApplication['status'], string> = {
  applied: 'Applied',
  shortlisted: 'Shortlisted',
  hired: 'Hired',
  rejected: 'Not taken forward',
}

export default function MyApplications({ applications }: { applications: MyApplication[] }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const withdraw = async (id: string, jobTitle: string) => {
    const ok = await confirm({
      title: 'Withdraw this application?',
      body: 'Withdrawing does not return the application to your monthly allowance.',
      confirmLabel: 'Withdraw',
    })
    if (!ok) return
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/applications', { signal: submitSignal(),
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not withdraw.')
      toast.success(`Withdrawn from “${jobTitle}”.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not withdraw.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-black text-tm-navy">Your applications</h2>
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      <ul className="space-y-2">
        {applications.map((a) => (
          <li key={a.id} className="space-y-2 rounded-xl bg-tm-bg p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-bold text-tm-navy">{a.jobTitle}</span>
              <span
                className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                  a.withdrawn
                    ? 'text-gray-500'
                    : a.status === 'hired'
                      ? 'text-tm-green-deep'
                      : a.status === 'rejected'
                        ? 'text-gray-500'
                        : 'text-tm-navy'
                }`}
              >
                {a.withdrawn ? 'Withdrawn' : LABEL[a.status]}
              </span>
            </div>

            {!a.withdrawn && a.status !== 'hired' && a.jobStatus === 'open' && (
              <button
                type="button"
                onClick={() => withdraw(a.id, a.jobTitle)}
                disabled={busy === a.id}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-[11px] font-bold text-gray-500 underline disabled:opacity-60"
              >
                <Trash2 aria-hidden size={12} />
                {busy === a.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
