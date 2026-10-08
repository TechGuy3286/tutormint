'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Maximize2, MessageCircle, BadgeCheck } from 'lucide-react'
import { normalisePkMobile } from '@/lib/phone'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import Lightbox, { type LightboxImage } from '@/components/admin/Lightbox'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { PARENT_REJECT_PRESETS, type ParentDocItem, type ParentItemState } from '@/lib/parentDocsCore'

// A parent's documents (owner, 8 Oct 2026): CNIC front + back and the typed
// address, each approved or rejected on its own. The member page's Documents
// box and the Verification → Parents queue render this same component and post
// to the same route, so a decision in one place shows in the other.
// Approving both makes the parent verified at once (green check).

const STATUS_LABEL: Record<ParentItemState['status'], { text: string; cls: string }> = {
  none: { text: 'Not provided', cls: 'bg-gray-100 text-gray-500' },
  pending: { text: 'Waiting for approval', cls: 'bg-tm-tint-navy text-tm-navy' },
  approved: { text: 'Approved', cls: 'bg-tm-tint-green text-tm-green-deep' },
  rejected: { text: 'Rejected', cls: 'bg-tm-tint-red text-tm-red' },
}

export type ParentDocsView = {
  parentId: string
  cnicFrontId: string | null
  cnicBackId: string | null
  cnicNumber: string | null
  address: string | null
  city: string | null
  cnic: ParentItemState
  addressItem: ParentItemState
  verified: boolean
  whatsapp: string | null
}

export default function ParentDocumentReview({ docs, canReview }: { docs: ParentDocsView; canReview: boolean }) {
  const images: LightboxImage[] = []
  const at: Record<string, number> = {}
  if (docs.cnicFrontId) { at.front = images.length; images.push({ src: `/api/documents/${docs.cnicFrontId}/preview`, alt: 'CNIC front' }) }
  if (docs.cnicBackId) { at.back = images.length; images.push({ src: `/api/documents/${docs.cnicBackId}/preview`, alt: 'CNIC back' }) }
  const [lbIndex, setLbIndex] = useState<number | null>(null)
  const [verified, setVerified] = useState(docs.verified)

  return (
    <div className="space-y-3">
      {verified && (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-tm-tint-green px-3 py-1 text-[11px] font-bold text-tm-green-deep">
          <BadgeCheck size={14} aria-hidden /> Verified — can message tutors and request demos
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewItem parentId={docs.parentId} item="cnic" title="CNIC (front & back)" canReview={canReview} state={docs.cnic} whatsapp={docs.whatsapp} onVerified={setVerified}>
          <div className="grid grid-cols-2 gap-2">
            {docs.cnicFrontId ? (
              <Zoomable onOpen={() => setLbIndex(at.front)}>
                <SecureDocumentPreview documentId={docs.cnicFrontId} alt="CNIC front" />
              </Zoomable>
            ) : (
              <NoImage label="No front" />
            )}
            {docs.cnicBackId ? (
              <Zoomable onOpen={() => setLbIndex(at.back)}>
                <SecureDocumentPreview documentId={docs.cnicBackId} alt="CNIC back" />
              </Zoomable>
            ) : (
              <NoImage label="No back" />
            )}
          </div>
          {/* The typed number sits with the images: checking a card IS comparing the two. */}
          <p className="font-mono text-xs font-black text-tm-navy">{docs.cnicNumber ?? 'No number typed'}</p>
        </ReviewItem>

        <ReviewItem parentId={docs.parentId} item="address" title="Home address" canReview={canReview} state={docs.addressItem} whatsapp={docs.whatsapp} onVerified={setVerified}>
          <p className="rounded-xl border border-gray-100 bg-tm-bg p-3 text-xs text-slate-700">
            {docs.address?.trim() ? docs.address : 'No address entered yet.'}
            {docs.city ? <span className="block text-[11px] text-gray-500">City: {docs.city}</span> : null}
          </p>
        </ReviewItem>
      </div>
      <Lightbox images={images} index={lbIndex} onIndex={setLbIndex} onClose={() => setLbIndex(null)} />
    </div>
  )
}

function Zoomable({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onOpen} aria-label="Open full size" className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl">
      {children}
      <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-tm-black/55 text-white opacity-80 group-hover:opacity-100">
        <Maximize2 size={14} aria-hidden />
      </span>
    </button>
  )
}

function NoImage({ label }: { label: string }) {
  return <div className="grid h-32 place-items-center rounded-xl border border-dashed border-gray-200 text-[11px] text-gray-500">{label}</div>
}

function ReviewItem({
  parentId,
  item,
  title,
  canReview: canReviewProp,
  state,
  whatsapp,
  onVerified,
  children,
}: {
  parentId: string
  item: ParentDocItem
  title: string
  canReview: boolean
  state: ParentItemState
  whatsapp: string | null
  onVerified: (v: boolean) => void
  children: React.ReactNode
}) {
  const toast = useToast()
  const router = useRouter()
  // A view-only (Partner) session sees each document and its status, never Approve/Reject.
  const readOnly = useAdminReadOnly()
  const canReview = canReviewProp && !readOnly
  const [status, setStatus] = useState(state.status)
  const [shownReason, setShownReason] = useState(state.reason)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [other, setOther] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [changing, setChanging] = useState(false)

  const s = STATUS_LABEL[status]
  const decided = status === 'approved' || status === 'rejected'
  const what = item === 'cnic' ? 'CNIC photo' : 'address'

  // "Send on WhatsApp" — the rejection message pre-written (staff press send),
  // English + Urdu, with the link to the verification page. Never a CNIC number.
  const waMsisdn = normalisePkMobile(whatsapp)
  const whatsappHref = (() => {
    if (!waMsisdn || reason.trim().length < 3) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tutormint.org'
    const link = `${origin}/parent/verify`
    const en = `Hi, your ${what} on TutorMint was not approved: ${reason.trim()} Please correct it here: ${link}`
    const ur = `السلام علیکم، آپ کی ${what} منظور نہیں ہوئی: ${reason.trim()} براہِ کرم یہاں درست کریں: ${link}`
    return `https://wa.me/${waMsisdn}?text=${encodeURIComponent(`${en}\n\n${ur}`)}`
  })()

  const act = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && reason.trim().length < 3) {
      setRejecting(true)
      toast.error('Choose or write a reason to reject.')
      return
    }
    setBusy(decision)
    const { ok, data } = await adminFetch<{ error?: string; verified?: boolean }>('/api/admin/parents/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, item, decision, reason: reason.trim() || null }),
    })
    setBusy(null)
    if (ok) {
      setStatus(decision === 'approve' ? 'approved' : 'rejected')
      setShownReason(decision === 'reject' ? reason.trim() : null)
      onVerified(!!data?.verified)
      setRejecting(false)
      setOther(false)
      setReason('')
      setChanging(false)
      toast.success(
        decision === 'approve'
          ? data?.verified
            ? 'Approved. The parent is now verified and was notified.'
            : 'Approved. The parent was notified.'
          : 'Rejected. The parent was notified.',
      )
      router.refresh()
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
      {shownReason && status === 'rejected' && <p className="text-[11px] text-tm-red">{shownReason}</p>}

      {canReview && !state.hasUpload && (
        <p className="text-[11px] font-semibold text-gray-500">
          {item === 'cnic' ? 'Not uploaded yet — nothing to review.' : 'No address entered yet — nothing to review.'}
        </p>
      )}

      {canReview && state.hasUpload && decided && !changing && (
        <button type="button" onClick={() => setChanging(true)} className="min-h-[32px] text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
          Change decision
        </button>
      )}

      {canReview && state.hasUpload && (!decided || changing) && (
        <div className="space-y-2">
          {rejecting && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {PARENT_REJECT_PRESETS[item].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setReason(p); setOther(false) }}
                    className={`rounded-lg border px-2 py-1 text-[10px] text-slate-700 hover:border-tm-navy ${reason === p ? 'border-tm-navy bg-tm-tint-navy' : 'border-gray-200'}`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setOther(true); setReason('') }}
                  className={`rounded-lg border px-2 py-1 text-[10px] text-slate-700 hover:border-tm-navy ${other ? 'border-tm-navy bg-tm-tint-navy' : 'border-gray-200'}`}
                >
                  Other
                </button>
              </div>
              {other && (
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Reason shown to the parent"
                  className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-tm-red"
                />
              )}
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-tm-green-deep/40 bg-tm-tint-green px-2.5 text-[11px] font-bold text-tm-green-deep"
                >
                  <MessageCircle size={12} aria-hidden /> Send on WhatsApp
                </a>
              )}
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
              {rejecting ? 'Confirm reject' : 'Reject'}
            </button>
          </div>
          {decided && changing && (
            <button
              type="button"
              onClick={() => { setChanging(false); setRejecting(false); setOther(false); setReason('') }}
              className="min-h-[28px] text-[11px] font-semibold text-gray-500 underline-offset-2 hover:underline"
            >
              Keep current decision
            </button>
          )}
        </div>
      )}
    </div>
  )
}
