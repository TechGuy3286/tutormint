'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// The bank-transfer details form. Text fields + an optional QR image. Saves
// through adminFetch (so the fresh-password prompt is handled in one place).

type Initial = {
  accountTitle: string
  bankName: string
  bankBranch: string
  accountNumber: string
  iban: string
  hasQr: boolean
}

const FIELDS: { name: keyof Omit<Initial, 'hasQr'>; label: string }[] = [
  { name: 'accountTitle', label: 'Account title' },
  { name: 'bankName', label: 'Bank' },
  { name: 'bankBranch', label: 'Branch' },
  { name: 'accountNumber', label: 'Account number' },
  { name: 'iban', label: 'IBAN' },
]

export default function BankDetailsForm({ initial }: { initial: Initial }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/bank-details', {
      method: 'POST',
      body: form,
    })
    setBusy(false)
    if (ok) {
      toast.success('Bank transfer details saved.')
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not save the details.')
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {FIELDS.map((f) => (
        <label key={f.name} className="block space-y-1">
          <span className="text-xs font-bold text-tm-navy">{f.label}</span>
          <input
            name={f.name}
            defaultValue={initial[f.name]}
            autoComplete="off"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-sm text-slate-700 focus:border-tm-navy focus:outline-none"
          />
        </label>
      ))}

      <div className="space-y-1">
        <span className="text-xs font-bold text-tm-navy">QR image (optional)</span>
        <p className="text-[11px] text-gray-500">
          {initial.hasQr ? 'A QR image is set.' : 'No QR image set — the QR block is hidden on checkout.'}
        </p>
        <input
          type="file"
          name="qr"
          accept="image/*"
          className="block w-full text-xs text-slate-700 file:mr-3 file:min-h-[44px] file:rounded-xl file:border file:border-gray-200 file:bg-white file:px-4 file:text-xs file:font-bold file:text-slate-700"
        />
        {initial.hasQr && (
          <label className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
            <input type="checkbox" name="removeQr" value="1" className="h-4 w-4" />
            Remove the current QR image
          </label>
        )}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save details'}
      </button>
    </form>
  )
}
