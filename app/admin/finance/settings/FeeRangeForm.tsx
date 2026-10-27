'use client'

// The "Fee match range" (owner, 27 Oct 2026; default Rs 199–210). A bank credit
// in it counts as a Verification Fee payment and the extra is recorded as
// rounding. OWNER ONLY: the Partner sees the numbers; the server refuses the
// save and asks the Owner for the password again.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'

const INPUT = 'min-h-[44px] w-28 rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'

export default function FeeRangeForm({ min, max, price }: { min: number; max: number; price: number }) {
  const readOnly = useAdminReadOnly()
  const router = useRouter()
  const toast = useToast()
  const [lo, setLo] = useState(String(min))
  const [hi, setHi] = useState(String(max))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/finance/fee-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ min: Number(lo), max: Number(hi) }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`Fee match range saved: Rs ${lo}–${hi}.`)
    router.refresh()
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" data-fee-range="">
      <h2 className="text-sm font-black text-tm-navy">Fee match range</h2>
      <p className="text-xs leading-relaxed text-slate-700">
        A bank credit between these amounts counts as a Verification Fee payment (the fee is Rs {price}). Anything above the fee is
        recorded on the payment as rounding, not as a problem. A credit below the lowest amount is shown as a partial payment and
        never activates.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-[11px] font-bold text-gray-600">Lowest (Rs)</span>
          <input value={lo} onChange={(e) => setLo(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className={INPUT} disabled={readOnly} />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold text-gray-600">Highest (Rs)</span>
          <input value={hi} onChange={(e) => setHi(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className={INPUT} disabled={readOnly} />
        </label>
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </section>
  )
}
