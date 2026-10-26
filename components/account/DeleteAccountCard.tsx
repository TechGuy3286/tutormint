'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// "Delete my account" (owner, 27 Oct 2026), in Settings → Account for tutors and
// parents. A code by SMS to the verified mobile confirms it; the account is then
// deleted in 7 days and can be cancelled until then (here, or from the banner on
// the dashboard). /api/account/delete.

type Pending = { dueAt: string; text: string } | null

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; data: { error?: string; dueAt?: string; text?: string; phone?: string } }> {
  try {
    const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: r.ok, data: await r.json().catch(() => ({})) }
  } catch {
    return { ok: false, data: { error: 'We could not reach TutorMint. Check your internet connection and try again.' } }
  }
}

export default function DeleteAccountCard() {
  const confirm = useConfirm()
  const toast = useToast()
  const [pending, setPending] = useState<Pending>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/account/delete')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { pending: Pending; phone: string | null } | null) => {
        if (!j) return
        setPending(j.pending)
        setPhone(j.phone)
      })
      .catch(() => {})
  }, [])

  const start = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      body: 'Your profile, contact details, documents and messages will be deleted 7 days after you confirm. You can cancel until then. We will send a code to your mobile to confirm it is you.',
      confirmLabel: 'Send code',
      cancelLabel: 'Keep my account',
    })
    if (!ok) return
    setBusy(true)
    const { ok: sent, data } = await call({ action: 'send-code' })
    setBusy(false)
    if (!sent) return void toast.error(data.error ?? 'That did not go through. Please try again.')
    setStep('code')
    toast.success(`Code sent to ${data.phone ?? 'your mobile'}.`)
  }

  const submit = async () => {
    setBusy(true)
    const { ok, data } = await call({ action: 'confirm', code })
    setBusy(false)
    if (!ok) return void toast.error(data.error ?? 'That did not go through. Please try again.')
    setPending({ dueAt: data.dueAt ?? '', text: data.text ?? 'Your account will be deleted in 7 days' })
    setStep('idle')
    setCode('')
    toast.success('Your account will be deleted in 7 days. You can cancel until then.')
  }

  const cancel = async () => {
    setBusy(true)
    const { ok, data } = await call({ action: 'cancel' })
    setBusy(false)
    if (!ok) return void toast.error(data.error ?? 'That did not go through. Please try again.')
    setPending(null)
    toast.success('Deletion cancelled. Your account stays.')
  }

  if (pending) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red-hover">
          {pending.text}.
        </p>
        <button type="button" onClick={() => void cancel()} disabled={busy} className="min-h-[44px] rounded-xl border border-gray-300 bg-white px-6 text-xs font-extrabold text-slate-800 disabled:opacity-60">
          {busy ? 'Cancelling…' : 'Cancel deletion'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-700">
        Delete your account and your personal data. It happens 7 days after you confirm, and you can cancel until then.
      </p>
      {!phone && <p className="text-[11px] text-gray-500">Verify your mobile number first, or ask support on WhatsApp 0321 5872222 to delete your account.</p>}
      {step === 'idle' ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || !phone}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-tm-red/40 bg-white px-6 text-xs font-extrabold text-tm-red hover:bg-tm-tint-red disabled:opacity-60"
        >
          <Trash2 aria-hidden size={15} /> {busy ? 'Sending…' : 'Delete my account'}
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[11px] font-bold text-tm-navy">Code sent to {phone}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              className="mt-1 block w-40 rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm tracking-widest"
            />
          </label>
          <button type="button" onClick={() => void submit()} disabled={busy || code.length !== 6} className="min-h-[44px] rounded-xl bg-tm-red px-6 text-xs font-extrabold text-white hover:bg-tm-red-hover disabled:opacity-60">
            {busy ? 'Checking…' : 'Confirm deletion'}
          </button>
          <button type="button" onClick={() => setStep('idle')} className="min-h-[44px] rounded-xl border border-gray-300 bg-white px-4 text-xs font-extrabold text-slate-800">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
