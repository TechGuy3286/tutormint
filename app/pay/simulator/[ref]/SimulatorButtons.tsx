'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// "Pay success" / "Pay fail". Both go through /api/payments/simulate, which
// signs a callback and posts it to the real webhook; neither touches a
// subscription directly.

export default function SimulatorButtons({ reference }: { reference: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pay = async (outcome: 'success' | 'failed') => {
    setBusy(outcome)
    setError(null)
    try {
      const res = await fetch('/api/payments/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, outcome }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'The test gateway failed.')
      router.push(`/pay/return?ref=${encodeURIComponent(reference)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test gateway failed.')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs font-bold text-tm-red">{error}</p>}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => pay('success')}
        className="min-h-[44px] w-full rounded bg-tm-green-deep px-4 text-sm font-bold text-white disabled:opacity-60"
      >
        {busy === 'success' ? 'Processing…' : 'Pay success'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => pay('failed')}
        className="min-h-[44px] w-full rounded border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-60"
      >
        {busy === 'failed' ? 'Processing…' : 'Pay fail'}
      </button>
    </div>
  )
}
