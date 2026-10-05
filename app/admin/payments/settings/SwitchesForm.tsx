'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

type Switches = { feeOpen: boolean; plansOpen: boolean }

const ROWS: { which: 'fee_open' | 'plans_open'; field: keyof Switches; title: string; sub: string }[] = [
  {
    which: 'fee_open',
    field: 'feeOpen',
    title: 'Rs 199 Spam Free Platform Fee open to all tutors',
    sub: 'Lets any tutor pay the one-time Spam Free Platform Fee.',
  },
  {
    which: 'plans_open',
    field: 'plansOpen',
    title: 'Plans (Premium / Featured) open to all',
    sub: 'Lets any tutor or parent buy a paid plan.',
  },
]

export default function SwitchesForm({ initial }: { initial: Switches }) {
  const router = useRouter()
  const toast = useToast()
  const [state, setState] = useState<Switches>(initial)
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (which: 'fee_open' | 'plans_open', field: keyof Switches) => {
    const next = !state[field]
    setBusy(which)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/switches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which, on: next }),
    })
    setBusy(null)
    if (ok) {
      setState((s) => ({ ...s, [field]: next }))
      toast.success(next ? 'Opened.' : 'Closed.')
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not change the switch.')
    }
  }

  return (
    <div className="space-y-3">
      {ROWS.map((r) => {
        const on = state[r.field]
        return (
          <div key={r.which} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold text-tm-navy">{r.title}</p>
              <p className="text-[11px] text-gray-500">{r.sub}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={r.title}
              disabled={busy === r.which}
              onClick={() => toggle(r.which, r.field)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                on ? 'bg-tm-green-deep' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        )
      })}
      <p className="text-[11px] text-gray-500">Each change is recorded in the audit log.</p>
    </div>
  )
}
