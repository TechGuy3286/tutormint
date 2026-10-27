'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, ShieldAlert, ShieldCheck } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { CONSENT_METHOD_LABEL, CONSENT_NOT_RECORDED_CHIP, STAFF_CONSENT_METHODS } from '@/lib/tuitionConsentCore'

// "Consent not recorded" on admin tuition cards and Applications (owner,
// 27 Oct 2026), with two actions:
//   Ask parent      WhatsApp with the editable consent_ask message (the
//                   number is added on the server; the page never has it);
//   Parent agreed   records consent with how they agreed — logged.
// If the parent says no, the contact is withdrawn (Trust → Withdraw a contact,
// Owner only). A recorded consent shows as a small green chip.

export default function ConsentChip({
  jobId,
  recorded,
  label,
  hasNumber = true,
  via = 'chip',
  compact = false,
}: {
  jobId: string
  recorded: boolean
  /** "Recorded — Phone call" when recorded. */
  label?: string | null
  hasNumber?: boolean
  via?: 'chip' | 'applications'
  compact?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const isOwner = useCanApprove()
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  if (recorded || done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-green px-2 py-0.5 text-[10px] font-bold text-tm-green-deep" data-consent="recorded">
        <ShieldCheck size={11} aria-hidden />
        {done ?? label ?? 'Consent recorded'}
      </span>
    )
  }

  const save = async () => {
    if (!method) {
      toast.error('Choose how the parent agreed.')
      return
    }
    setBusy(true)
    const res = await adminFetch('/api/admin/jobs/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, method, note: note.trim() || null, via }),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error((res.data as { error?: string })?.error ?? 'That did not save. Please try again.')
      return
    }
    const text = `Recorded — ${CONSENT_METHOD_LABEL[method as keyof typeof CONSENT_METHOD_LABEL]}`
    setDone(text)
    setOpen(false)
    toast.success('Consent recorded. The parent’s number can be shared with tutors now.')
    router.refresh()
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${compact ? '' : 'rounded-xl border border-tm-red/30 bg-tm-tint-red px-2 py-1'}`} data-consent="not_recorded">
      <span className="inline-flex items-center gap-1 text-[10px] font-black text-tm-red">
        <ShieldAlert size={11} aria-hidden />
        {CONSENT_NOT_RECORDED_CHIP}
      </span>
      {!readOnly && (
        <>
          {hasNumber ? (
            <a
              href={`/api/admin/jobs/consent/ask?jobId=${jobId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[28px] items-center gap-1 rounded-lg bg-tm-green-deep px-2 text-[10px] font-bold text-white hover:bg-tm-green-deep-hover"
              data-consent-ask=""
            >
              <MessageCircle size={11} aria-hidden />
              Ask parent
            </a>
          ) : (
            <span className="text-[10px] font-bold text-slate-700">No parent number</span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[28px] items-center rounded-lg border border-tm-navy/30 bg-white px-2 text-[10px] font-bold text-tm-navy hover:border-tm-navy"
            aria-expanded={open}
          >
            Parent agreed
          </button>
          {isOwner ? (
            <Link href="/admin/withdraw-contact" className="text-[10px] font-bold text-tm-red hover:underline">
              Parent said no? Withdraw the contact
            </Link>
          ) : (
            <span className="text-[10px] text-slate-700">Parent said no? Ask the Owner to withdraw the contact.</span>
          )}
        </>
      )}
      {open && !readOnly && (
        <span className="flex w-full flex-wrap items-center gap-1.5 pt-1">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            aria-label="How did the parent agree?"
            className="min-h-[32px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-semibold text-tm-navy"
          >
            <option value="">How did they agree?</option>
            {STAFF_CONSENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {CONSENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Note (optional)"
            aria-label="Note"
            className="min-h-[32px] min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px]"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex min-h-[32px] items-center rounded-lg bg-tm-navy px-3 text-[11px] font-bold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </span>
      )}
    </span>
  )
}
