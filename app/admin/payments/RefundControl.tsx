'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { REFUND_METHODS, REFUND_REASONS } from '@/lib/payments/refundCore'

// "Mark as refunded" on an approved payment (PR106-H4 §4). Owner/admin only
// (the parent gates it on canApprove); adminFetch handles the fresh-password
// prompt. Multipart so an optional proof screenshot can ride along. The original
// payment is never changed except its refund fields.
export default function RefundControl({
  paymentId,
  payerName,
  amountPkr,
  alreadyRefunded,
}: {
  paymentId: string
  payerName: string
  amountPkr: number
  alreadyRefunded: number
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const remaining = amountPkr - (alreadyRefunded ?? 0)
  const [amount, setAmount] = useState(String(remaining))
  const [method, setMethod] = useState<string>(REFUND_METHODS[0])
  const [reason, setReason] = useState<string>(REFUND_REASONS[0])
  const [otherReason, setOtherReason] = useState('')
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState<File | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const fd = new FormData()
    fd.set('paymentId', paymentId)
    fd.set('amount', amount)
    fd.set('method', method)
    fd.set('reason', reason === 'Other' ? otherReason : reason)
    fd.set('reference', reference)
    if (proof) fd.set('proof', proof)
    const { ok, data } = await adminFetch<{ error?: string; amount?: number }>('/api/admin/payments/refund', {
      method: 'POST',
      body: fd,
    })
    setBusy(false)
    if (ok) {
      toast.success(`Refund recorded: Rs ${(data?.amount ?? 0).toLocaleString('en-PK')} to ${payerName}.`)
      setOpen(false)
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not record the refund.')
    }
  }

  if (readOnly) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-tm-navy/30 px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy"
      >
        <RotateCcw aria-hidden size={13} />
        Mark as refunded
      </button>
    )
  }

  const field = 'min-h-[40px] w-full rounded-xl border border-gray-200 px-3 text-xs'
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-gray-200 bg-tm-bg p-3">
      <p className="text-[11px] font-black text-tm-navy">Record a refund for {payerName}</p>
      <label className="block text-[11px] font-bold text-gray-500">
        Amount (Rs)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={field} />
      </label>
      <label className="block text-[11px] font-bold text-gray-500">
        Method
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
          {REFUND_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="block text-[11px] font-bold text-gray-500">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={field}>
          {REFUND_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {reason === 'Other' && (
        <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Reason" className={field} />
      )}
      <label className="block text-[11px] font-bold text-gray-500">
        Refund reference / transaction ID (optional)
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
      </label>
      <label className="block text-[11px] font-bold text-gray-500">
        Proof screenshot (optional)
        <input type="file" accept="image/*" onChange={(e) => setProof(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-[11px]" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-[40px] rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60">
          {busy ? 'Saving…' : 'Record refund'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[40px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  )
}
