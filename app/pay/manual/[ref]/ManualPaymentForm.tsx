'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Transaction ID + receipt screenshot. Both go to /api/payments/manual, which
// keeps the payment pending -- submitting a receipt is a claim, not a payment.

export default function ManualPaymentForm({
  reference,
  methods,
}: {
  reference: string
  methods: { code: string; label: string }[]
}) {
  const router = useRouter()
  const [method, setMethod] = useState(methods[0]?.code ?? '')
  const [payerReference, setPayerReference] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('reference', reference)
      form.set('method', method)
      form.set('payerReference', payerReference.trim())
      if (file) form.set('screenshot', file)

      const res = await fetch('/api/payments/manual', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not submit your payment.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[11px] font-bold text-gray-500">How did you pay?</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
        >
          {methods.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-bold text-gray-500">Transaction ID from your receipt</span>
        <input
          value={payerReference}
          onChange={(e) => setPayerReference(e.target.value)}
          placeholder="e.g. 4429183756"
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold outline-none focus:border-[#d60008]"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-bold text-gray-500">Screenshot of the transfer</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white p-2 text-xs"
        />
        <span className="block text-[10px] leading-relaxed text-gray-400">
          Only our finance team can open it. It is stored privately and never shown on your profile.
        </span>
      </label>

      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || payerReference.trim().length < 4}
        className="min-h-[44px] w-full rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white disabled:bg-gray-300"
      >
        {busy ? 'Sending…' : 'Submit for review'}
      </button>
    </div>
  )
}
