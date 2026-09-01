'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const withdraw = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not withdraw.')
      setConfirming(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not withdraw.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-black text-[#0F172A]">Your applications</h2>
      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      <ul className="space-y-2">
        {applications.map((a) => (
          <li key={a.id} className="space-y-2 rounded-xl bg-[#F8FAFC] p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-bold text-[#0F172A]">{a.jobTitle}</span>
              <span
                className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                  a.withdrawn
                    ? 'text-gray-400'
                    : a.status === 'hired'
                      ? 'text-[#059669]'
                      : a.status === 'rejected'
                        ? 'text-gray-500'
                        : 'text-[#0F172A]'
                }`}
              >
                {a.withdrawn ? 'Withdrawn' : LABEL[a.status]}
              </span>
            </div>

            {!a.withdrawn && a.status !== 'hired' && a.jobStatus === 'open' && (
              <>
                {confirming === a.id ? (
                  <div className="space-y-2">
                    <p className="text-[11px] leading-relaxed text-[#334155]">
                      Withdrawing does not return the application to your monthly allowance.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => withdraw(a.id)}
                        disabled={busy}
                        className="min-h-[44px] flex-1 rounded-xl bg-[#d60008] px-3 text-xs font-bold text-white"
                      >
                        {busy ? 'Withdrawing…' : 'Withdraw anyway'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-xs font-bold text-[#334155]"
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(a.id)}
                    className="min-h-[44px] text-[11px] font-bold text-gray-500 underline"
                  >
                    Withdraw
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
