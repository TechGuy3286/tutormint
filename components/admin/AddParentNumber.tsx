'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PlayCircle } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { parseContactNumber } from '@/lib/tuitionContactCore'

// "Add parent number" for a staff-posted tuition with no contact number (owner,
// 12 Oct 2026). ONE control for Paused tuitions (where saving the number also
// resumes the tuition) and Applicants to forward (where saving offers "Resume
// now" when the tuition was paused for having no number). The same validation as
// the Post a tuition form; the server refuses a bad number too. Never rendered
// for a view-only Partner — the callers gate on useAdminReadOnly.

const INPUT = 'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold disabled:opacity-50'

export default function AddParentNumber({
  jobId,
  resumeOnSave = false,
  offerResume = false,
  onCancel,
}: {
  jobId: string
  /** Paused tuitions: save the number and resume in one step. */
  resumeOnSave?: boolean
  /** Applicants to forward: after saving, offer "Resume now" when the tuition is paused for no number. */
  offerResume?: boolean
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canResume, setCanResume] = useState(false)

  const send = async (resume: boolean) => {
    const parsed = parseContactNumber(phone)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; resumed?: boolean; canResume?: boolean }>('/api/admin/jobs/contact-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, phone, resume }),
    })
    setBusy(false)
    if (!ok) {
      setError(data?.error ?? 'That did not save. Please try again.')
      return
    }
    if (data?.resumed) {
      toast.success('Number saved. The tuition is live again for 15 days, on the same address.')
      router.refresh()
      return
    }
    toast.success('Parent number saved.')
    if (offerResume && data?.canResume) {
      setCanResume(true)
      return
    }
    router.refresh()
  }

  if (canResume) {
    return (
      <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-tint-green p-3">
        <p className="text-xs font-bold text-tm-green-deep">Number saved. This tuition was paused for having no contact number.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void send(true)} className={`${BTN} bg-tm-green-deep text-white`}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <PlayCircle size={14} aria-hidden />} Resume now
          </button>
          <button type="button" disabled={busy} onClick={() => router.refresh()} className={`${BTN} border border-gray-200 bg-white text-slate-700`}>
            Not now
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
      <label className="block">
        <span className="block text-[11px] font-bold text-gray-600">Parent contact number</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0300 1234567"
          inputMode="tel"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className={INPUT}
        />
      </label>
      {error && (
        <p role="alert" className="text-[11px] font-bold text-tm-red">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void send(resumeOnSave)} className={`${BTN} bg-tm-navy text-white`}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {resumeOnSave ? 'Save number and resume' : 'Save number'}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel} className={`${BTN} border border-gray-200 bg-white text-slate-700`}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
