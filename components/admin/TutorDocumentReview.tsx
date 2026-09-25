'use client'

import { useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { DocumentStatuses, DocItem, DocState } from '@/lib/tutorDocuments'

// Per-item identity review (PR60): CNIC front/back, profile picture and selfie
// side by side, each approved or rejected on its own. A reject needs a reason
// (a short preset or free text). This changes NO listing rule.

const REJECT_PRESETS = [
  'The photo is blurry — please retake it clearly.',
  'The details do not match.',
  'The face is not clearly visible.',
  'This is not the right document.',
]

const STATUS_LABEL: Record<DocState['status'], { text: string; cls: string }> = {
  none: { text: 'Not uploaded', cls: 'bg-gray-100 text-gray-500' },
  pending: { text: 'Waiting for approval', cls: 'bg-tm-tint-navy text-tm-navy' },
  approved: { text: 'Approved', cls: 'bg-tm-tint-green text-tm-green-deep' },
  rejected: { text: 'Rejected', cls: 'bg-tm-tint-red text-tm-red' },
}

export default function TutorDocumentReview({
  tutorId,
  canReview,
  avatarUrl,
  cnicFrontId,
  cnicBackId,
  selfieDocId,
  statuses,
}: {
  tutorId: string
  canReview: boolean
  avatarUrl: string | null
  cnicFrontId: string | null
  cnicBackId: string | null
  selfieDocId: string | null
  statuses: DocumentStatuses
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
        Identity review — CNIC, profile picture &amp; selfie
      </h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <ReviewItem
          tutorId={tutorId}
          item="cnic"
          title="CNIC (front & back)"
          canReview={canReview}
          state={statuses.cnic}
        >
          <div className="grid grid-cols-2 gap-2">
            {cnicFrontId ? (
              <SecureDocumentPreview documentId={cnicFrontId} alt="CNIC front" />
            ) : (
              <NoImage label="No front" />
            )}
            {cnicBackId ? (
              <SecureDocumentPreview documentId={cnicBackId} alt="CNIC back" />
            ) : (
              <NoImage label="No back" />
            )}
          </div>
        </ReviewItem>

        <ReviewItem
          tutorId={tutorId}
          item="profile_pic"
          title="Profile picture"
          canReview={canReview}
          state={statuses.profilePic}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only review thumbnail
            <img src={avatarUrl} alt="Profile picture" className="h-32 w-32 rounded-xl object-cover" />
          ) : (
            <NoImage label="No picture" />
          )}
        </ReviewItem>

        <ReviewItem
          tutorId={tutorId}
          item="selfie"
          title="Selfie"
          canReview={canReview}
          state={statuses.selfie}
        >
          {selfieDocId ? (
            <SecureDocumentPreview documentId={selfieDocId} alt="Selfie" />
          ) : (
            <NoImage label="No selfie" />
          )}
        </ReviewItem>
      </div>
    </section>
  )
}

function NoImage({ label }: { label: string }) {
  return (
    <div className="grid h-32 place-items-center rounded-xl border border-dashed border-gray-200 text-[11px] text-gray-500">
      {label}
    </div>
  )
}

function ReviewItem({
  tutorId,
  item,
  title,
  canReview,
  state,
  children,
}: {
  tutorId: string
  item: DocItem
  title: string
  canReview: boolean
  state: DocState
  children: React.ReactNode
}) {
  const toast = useToast()
  const [status, setStatus] = useState(state.status)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  const s = STATUS_LABEL[status]

  const act = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && reason.trim().length < 3) {
      setRejecting(true)
      toast.error('Give a reason to reject.')
      return
    }
    setBusy(decision)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/tutors/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId, item, decision, reason: reason.trim() || null }),
    })
    setBusy(null)
    if (ok) {
      setStatus(decision === 'approve' ? 'approved' : 'rejected')
      setRejecting(false)
      setReason('')
      toast.success(decision === 'approve' ? 'Approved. The tutor was notified.' : 'Rejected. The tutor was notified.')
    } else {
      toast.error(data?.error ?? 'Could not save that.')
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-black text-tm-navy">{title}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.text}</span>
      </div>
      {children}
      {state.reason && status === 'rejected' && (
        <p className="text-[11px] text-tm-red">{state.reason}</p>
      )}

      {canReview && (
        <div className="space-y-2">
          {rejecting && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {REJECT_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setReason(p)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] text-slate-700 hover:border-tm-navy"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Reason shown to the tutor"
                className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-tm-red"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => act('approve')}
              disabled={!!busy}
              className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1 rounded-lg bg-tm-green-deep px-3 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Approve
            </button>
            <button
              type="button"
              onClick={() => (rejecting ? act('reject') : setRejecting(true))}
              disabled={!!busy}
              className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1 rounded-lg border border-tm-red px-3 text-[11px] font-bold text-tm-red disabled:opacity-50"
            >
              {busy === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
