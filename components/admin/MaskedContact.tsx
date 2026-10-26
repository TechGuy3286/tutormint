'use client'

import { useState } from 'react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { RevealField } from '@/lib/contactMaskCore'

// A masked phone or email in the member page header with a "Show" button
// (owner, 26 Oct 2026). Show asks the server, which writes Audit first; the
// value is held only in this component and hidden again on Hide.

export default function MaskedContact({ memberId, field, masked }: { memberId: string; field: RevealField; masked: string }) {
  const toast = useToast()
  const [value, setValue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function show() {
    setBusy(true)
    const { ok, data } = await adminFetch<{ value?: string; error?: string }>('/api/admin/members/reveal-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, field }),
    })
    setBusy(false)
    if (!ok || !data?.value) return toast.error(data?.error ?? 'That did not load. Please try again.')
    setValue(data.value)
  }
  return (
    <span className="inline-flex items-center gap-1.5" data-masked-contact={field}>
      <span className="font-mono">{value ?? masked}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => (value ? setValue(null) : void show())}
        className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50"
      >
        {value ? 'Hide' : busy ? '…' : 'Show'}
      </button>
    </span>
  )
}
