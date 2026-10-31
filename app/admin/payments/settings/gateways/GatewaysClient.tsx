'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { methodChangeError, type GatewayId, type GatewaySettings, type MethodKey } from '@/lib/payments/gatewaySettingsCore'

// The controls on Admin → Settings → Payment gateways (owner, 6 Oct 2026, item
// 19). Every change posts to /api/admin/payments/gateways, which re-checks owner,
// asks for the password when it is stale, refuses a change that breaks a rule,
// and writes the audit log.

// PayPro is retired (owner, 26 Oct 2026) and is not offered as a way to pay;
// the leave-and-come-back link is gone too (owner, 27 Oct 2026). Bank transfer
// is the one way to pay.
const METHOD_ROWS: { key: MethodKey; title: string; sub: string }[] = [
  {
    key: 'bank_transfer',
    title: 'Show bank transfer to members',
    sub: 'Adds “Other methods” to the payment choice screen, with the bank details below. The member uploads a receipt and staff approve it before anything activates. Hidden automatically while the bank details are empty.',
  },
]

function Switch({ on, label, busy, onClick }: { on: boolean; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? 'bg-tm-green-deep' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function GatewaysClient({
  initial,
  configured: _configured,
}: {
  initial: GatewaySettings
  configured: Record<GatewayId, boolean>
}) {
  const router = useRouter()
  const toast = useToast()
  const [s, setS] = useState<GatewaySettings>(initial)
  // The Partner sees the settings and cannot change them (owner, 8 Oct 2026):
  // every control is shown in its state but locked; the route refuses anyway.
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState<string | null>(readOnly ? 'read-only' : null)

  const send = async (key: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(key)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/gateways', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return false
    }
    router.refresh()
    return true
  }

  const toggleMethod = async (key: MethodKey) => {
    const next = !s.methods[key]
    const problem = methodChangeError(s, key, next)
    if (problem) {
      toast.error(problem)
      return
    }
    if (await send(key, { change: 'method', method: key, on: next })) {
      setS((p) => ({ ...p, methods: { ...p.methods, [key]: next } }))
      toast.success(next ? 'Turned on.' : 'Turned off. It no longer shows at checkout.')
    }
  }


  const row = 'flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4'

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Ways to pay</h2>
        {METHOD_ROWS.map((m) => (
          <div key={m.key} className={row}>
            <div className="min-w-0">
              <p className="text-sm font-bold text-tm-navy">{m.title}</p>
              <p className="text-[11px] text-gray-500">{m.sub}</p>
            </div>
            <Switch on={s.methods[m.key]} label={m.title} busy={readOnly || busy === m.key} onClick={() => void toggleMethod(m.key)} />
          </div>
        ))}
        <p className="text-[11px] text-gray-500">
          At least one way to pay must stay on. A way to pay that is off disappears from checkout, and checkout also refuses
          it.
        </p>
      </section>

    </div>
  )
}
