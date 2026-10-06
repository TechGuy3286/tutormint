'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { GATEWAYS, methodChangeError, type GatewayId, type GatewaySettings, type MethodKey } from '@/lib/payments/gatewaySettingsCore'

// The controls on Admin → Settings → Payment gateways (owner, 6 Oct 2026, item
// 19). Every change posts to /api/admin/payments/gateways, which re-checks owner,
// asks for the password when it is stale, refuses a change that breaks a rule,
// and writes the audit log.

const METHOD_ROWS: { key: MethodKey; title: string; sub: string }[] = [
  {
    key: 'paypro_online',
    title: 'Online payment on PayPro',
    sub: 'JazzCash, Easypaisa and card. PayPro shows these three together on its own page, so they turn on and off together — PayPro does not let us switch one of them off on its own.',
  },
  {
    key: 'bank_transfer',
    title: 'Bank transfer',
    sub: 'Our own bank transfer page. The member sends proof and staff check it before it activates.',
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
  configured,
}: {
  initial: GatewaySettings
  configured: Record<GatewayId, boolean>
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [s, setS] = useState<GatewaySettings>(initial)
  const [busy, setBusy] = useState<string | null>(null)

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

  const chooseGateway = async (id: GatewayId) => {
    if (id === s.active || !configured[id]) return
    const name = GATEWAYS.find((g) => g.id === id)?.name ?? id
    const ok = await confirm({
      title: `Make ${name} the active gateway?`,
      body: `Every new online payment will go through ${name} from now on. Payments already started stay with their gateway.`,
      confirmLabel: `Switch to ${name}`,
      destructive: false,
    })
    if (!ok) return
    if (await send(`active-${id}`, { change: 'active', gateway: id })) {
      setS((p) => ({ ...p, active: id }))
      toast.success(`${name} is now the active gateway.`)
    }
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

  const togglePayLater = async () => {
    const next = !s.payLater
    if (await send('pay_later', { change: 'pay_later', on: next })) {
      setS((p) => ({ ...p, payLater: next }))
      toast.success(next ? '“Pay later” is on.' : '“Pay later” is off.')
    }
  }

  const row = 'flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4'

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Active gateway</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GATEWAYS.map((g) => {
            const isActive = s.active === g.id
            const ready = configured[g.id]
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => void chooseGateway(g.id)}
                disabled={!ready || isActive || busy !== null}
                aria-pressed={isActive}
                className={`flex min-h-[64px] flex-col items-start justify-center rounded-2xl border p-4 text-left ${
                  isActive ? 'border-tm-green-deep bg-tm-tint-green' : 'border-gray-200 bg-white'
                } ${!ready ? 'cursor-not-allowed' : ''}`}
              >
                <span className={`text-sm font-black ${isActive ? 'text-tm-green-deep' : 'text-tm-navy'}`}>{g.name}</span>
                <span className="text-[11px] text-gray-600">
                  {isActive ? 'Active now' : ready ? 'Ready — tap to make active' : 'Not configured'}
                </span>
              </button>
            )
          })}
        </div>
        {!configured.assanpay && (
          <p className="text-[11px] text-gray-500">
            AssanPay cannot be chosen until its connection is built and its settings are added in Vercel.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Ways to pay</h2>
        {METHOD_ROWS.map((m) => (
          <div key={m.key} className={row}>
            <div className="min-w-0">
              <p className="text-sm font-bold text-tm-navy">{m.title}</p>
              <p className="text-[11px] text-gray-500">{m.sub}</p>
            </div>
            <Switch on={s.methods[m.key]} label={m.title} busy={busy === m.key} onClick={() => void toggleMethod(m.key)} />
          </div>
        ))}
        <p className="text-[11px] text-gray-500">
          At least one way to pay must stay on. A way to pay that is off disappears from checkout, and checkout also refuses
          it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Pay later</h2>
        <div className={row}>
          <div className="min-w-0">
            <p className="text-sm font-bold text-tm-navy">Show a &ldquo;Pay later&rdquo; link</p>
            <p className="text-[11px] text-gray-500">Lets a member leave the payment step and come back to it later.</p>
          </div>
          <Switch on={s.payLater} label="Pay later" busy={busy === 'pay_later'} onClick={() => void togglePayLater()} />
        </div>
      </section>
    </div>
  )
}
