'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { EyeOff, Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { NI_REASONS, NI_REASON_LABEL, niMarkProblem, type NiReason } from '@/lib/notInterestedCore'

// "Not interested" (owner, 21 Oct 2026; a reason is required since 11 Nov
// 2026): a small form with five quick reasons and an optional note. The
// member leaves every pending list, badge and to-do; "Undo" puts them back,
// and an upload or a payment brings them back on their own. Nothing is
// deleted — who, when, the reason and the note are recorded (migration 191 /
// 229, admin_audit_log).

export default function NotInterestedButton({
  memberId,
  marked,
  onDone,
}: {
  memberId: string
  /** Already marked — the button undoes the mark. */
  marked: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<NiReason | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (readOnly) return null

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/follow-ups/not-interested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...payload }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return false
    }
    return true
  }

  const undo = async () => {
    if (await post({ undo: true })) {
      toast.success('Back on the lists.')
      onDone?.()
      router.refresh()
    }
  }

  const problem = niMarkProblem(reason, note)
  const save = async () => {
    if (problem) return
    if (await post({ reason, note: note.trim() || null })) {
      toast.success('Moved to Not interested.')
      setOpen(false)
      setReason(null)
      setNote('')
      onDone?.()
      router.refresh()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (marked ? void undo() : setOpen(true))}
        disabled={busy}
        className="inline-flex min-h-[32px] items-center gap-1 self-start text-[11px] font-bold text-gray-600 underline-offset-2 hover:text-tm-navy hover:underline disabled:opacity-50"
      >
        {marked ? <Undo2 aria-hidden size={12} /> : <EyeOff aria-hidden size={12} />}
        {busy && marked ? 'Saving…' : marked ? 'Undo not interested' : 'Not interested'}
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div data-ni-overlay="" className="fixed inset-0 z-[60] flex items-end justify-center bg-tm-black/50 p-3 sm:items-center" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={`ni-title-${memberId}`}
              data-ni-form=""
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl"
            >
              <p id={`ni-title-${memberId}`} className="text-sm font-black text-tm-navy">
                Why not interested?
              </p>
              <fieldset className="space-y-1.5">
                <legend className="sr-only">Reason</legend>
                {NI_REASONS.map((r) => (
                  <label key={r} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-slate-800 has-[:checked]:border-tm-navy has-[:checked]:bg-tm-tint-navy">
                    <input type="radio" name={`ni-${memberId}`} value={r} checked={reason === r} onChange={() => setReason(r)} />
                    {NI_REASON_LABEL[r]}
                  </label>
                ))}
              </fieldset>
              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-gray-600">Note (optional{reason === 'other' ? ' — needed for Other' : ''})</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="block w-full rounded-xl border border-gray-200 px-3 py-2 text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || !!problem}
                  onClick={() => void save()}
                  className="min-h-[44px] rounded-xl bg-tm-navy px-4 text-xs font-bold text-white disabled:bg-gray-300"
                >
                  {busy ? 'Saving…' : 'Not interested'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700">
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-gray-500">They leave the lists. If they upload a document or pay, they come back on their own.</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
