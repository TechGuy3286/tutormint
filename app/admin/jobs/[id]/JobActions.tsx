'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// Close, un-feature, remove.
//
// Each writes admin_audit_log and notifies the parent -- the route does both,
// so a screen added later cannot forget either. The reason box is shared: it
// is optional for close and un-feature and required for remove, because
// "removed" with no stated cause is the version a parent cannot argue with and
// support cannot explain.
//
// Nothing is deleted. Remove closes the tuition and drops the Featured tag;
// the row, its applications and its threads stay, so a mistake is recoverable
// and a tutor keeps the application they spent quota on.

export default function JobActions({
  jobId,
  status,
  isFeatured,
}: {
  jobId: string
  status: string
  isFeatured: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const act = async (action: 'close' | 'unfeature' | 'remove') => {
    if (action === 'remove') {
      const ok = await confirm({
        title: 'Remove this tuition from the board?',
        body: 'It closes and loses its Featured tag. Nothing is deleted — the post, its applications and its conversations stay.',
        confirmLabel: 'Remove',
      })
      if (!ok) return
    }
    setBusy(action)
    setError(null)
    setDone(null)

    const r = await adminFetch<{ error?: string }>('/api/admin/jobs/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, action, reason }),
    })

    if (r.ok) {
      const message =
        action === 'close'
          ? 'Closed. The parent has been notified.'
          : action === 'unfeature'
            ? 'Featured tag removed. The parent has been notified.'
            : 'Removed from the board. The parent has been notified.'
      setDone(message)
      toast.success(message)
      setReason('')
      router.refresh()
    } else {
      const message = r.data?.error ?? 'Could not do that.'
      setError(message)
      toast.error(message)
    }
    setBusy(null)
  }

  const Button = ({
    action,
    label,
    className,
    disabled,
  }: {
    action: 'close' | 'unfeature' | 'remove'
    label: string
    className: string
    disabled?: boolean
  }) => (
    <button
      type="button"
      onClick={() => act(action)}
      disabled={!!busy || disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors disabled:opacity-50 ${className}`}
    >
      {busy === action && <Loader2 size={13} className="animate-spin" aria-hidden />}
      {label}
    </button>
  )

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Actions</h2>

      {done && (
        <p className="rounded-xl bg-tm-tint-green p-3 text-[11px] font-bold text-tm-green-deep">
          {done}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-tm-tint-red p-3 text-[11px] font-bold text-tm-red">{error}</p>
      )}

      <label className="block space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
          Reason (required to remove — the parent is shown this)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Duplicate of JOB-TX-XXXXXX, or contact details in the description"
          className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none focus:border-tm-red"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          action="close"
          label={status === 'open' ? 'Close this tuition' : 'Already closed'}
          disabled={status !== 'open'}
          className="border border-gray-200 text-tm-navy hover:border-tm-navy"
        />
        <Button
          action="unfeature"
          label={isFeatured ? 'Remove Featured tag' : 'Not featured'}
          disabled={!isFeatured}
          className="border border-gray-200 text-tm-navy hover:border-tm-navy"
        />
        <Button
          action="remove"
          label="Remove from the board"
          className="bg-tm-red text-white hover:bg-tm-red-hover"
        />
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Nothing is deleted. Removing closes the tuition and drops the Featured tag; the post, its
        applications and its conversations stay, so a mistake can be undone.
      </p>
    </section>
  )
}
