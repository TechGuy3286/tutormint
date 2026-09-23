'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Close, pause/resume, un-feature.
//
// NOTHING IS DELETED, EVER (PR49 §4). There is no "remove" button any more.
// A tuition that is finished is Closed; one that is not needed right now is
// Paused and brought back later. Either way the post, its applications and its
// chats stay, so nothing a tutor spent effort on is lost and a mistake can be
// undone.
//
// Each action writes admin_audit_log and tells the parent -- the route does
// both, so a screen added later cannot forget either. The reason box is
// optional; whatever is typed is shown to the parent in the message they get.

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

  const act = async (action: 'close' | 'unfeature' | 'pause' | 'resume') => {
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
          ? 'Done. This tuition is closed and the parent has been told.'
          : action === 'unfeature'
            ? 'Done. The Featured tag is removed and the parent has been told.'
            : action === 'pause'
              ? 'Done. This tuition is paused and the parent has been told.'
              : 'Done. This tuition is live again and the parent has been told.'
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
    action: 'close' | 'unfeature' | 'pause' | 'resume'
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
          Reason for the parent (optional)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="The parent sees this. For example: a tutor has been found, or a phone number is not allowed in the details."
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
        {status === 'paused' ? (
          <Button
            action="resume"
            label="Bring it back"
            className="bg-tm-red text-white hover:bg-tm-red-hover"
          />
        ) : (
          <Button
            action="pause"
            label={status === 'open' ? 'Pause this tuition' : 'Cannot pause'}
            disabled={status !== 'open'}
            className="border border-gray-200 text-tm-navy hover:border-tm-navy"
          />
        )}
        <Button
          action="unfeature"
          label={isFeatured ? 'Remove the Featured tag' : 'Not featured'}
          disabled={!isFeatured}
          className="border border-gray-200 text-tm-navy hover:border-tm-navy"
        />
      </div>

      <div className="space-y-1.5 text-[10px] leading-relaxed text-gray-500">
        <p>
          <span className="font-bold text-gray-700">Close</span> — the tuition is finished. Use this
          when a tutor has been found, or the parent no longer needs one. Tutors can no longer apply.
        </p>
        <p>
          <span className="font-bold text-gray-700">Pause</span> — hide the tuition for now and bring
          it back later with “Bring it back”. Tutors cannot apply while it is paused. Use this if the
          tuition may be needed again soon.
        </p>
        <p>Nothing is ever deleted. The post, its applications and its chats always stay.</p>
      </div>
    </section>
  )
}
