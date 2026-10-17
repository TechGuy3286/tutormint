'use client'

import { useState } from 'react'
import CnicShow from '@/components/admin/CnicShow'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, MessageCircle, BadgeCheck } from 'lucide-react'
import { normalisePkMobile } from '@/lib/phone'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import DocumentViewer, { ViewerThumb as Zoomable, type ViewerImage } from '@/components/admin/DocumentViewer'
import { SavedCnicDuplicate } from '@/components/admin/AdminCnicNumberBox'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { OwnerOnlyNote, useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import { PARENT_REJECT_PRESETS, type ParentDocItem, type ParentItemState } from '@/lib/parentDocsCore'
import { buildRejectReason, rejectionWhatsAppText } from '@/lib/rejectReasonsCore'
import RejectReasonPicker from '@/components/admin/RejectReasonPicker'
import { cnicSideNote } from '@/lib/tutorDocQueueCore'
import UnlockDocButton from '@/components/admin/UnlockDocButton'

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
  /** MASKED (XXXXX-XXXXXXX-4); the Owner's "Show" fetches the full number. */
  cnicNumber: string | null
  address: string | null
  city: string | null
  cnic: ParentItemState
  addressItem: ParentItemState
  verified: boolean
  whatsapp: string | null
  /** A new upload of the approved CNIC waiting for review (owner, 9 Oct 2026). */
  cnicFrontReviewId?: string | null
  cnicBackReviewId?: string | null
}

export default function ParentDocumentReview({
  docs,
  canReview,
  lockable = false,
  unlockOpen = false,
  canUnlock = false,
}: {
  docs: ParentDocsView
  canReview: boolean
  /** The CNIC is approved and on record, so it can be unlocked for re-upload. */
  lockable?: boolean
  unlockOpen?: boolean
  canUnlock?: boolean
}) {
  const images: ViewerImage[] = []
  const at: Record<string, number> = {}
  if (docs.cnicFrontId) { at.front = images.length; images.push({ src: `/api/documents/${docs.cnicFrontId}/preview`, alt: 'CNIC front', documentId: docs.cnicFrontId }) }
  if (docs.cnicBackId) { at.back = images.length; images.push({ src: `/api/documents/${docs.cnicBackId}/preview`, alt: 'CNIC back', documentId: docs.cnicBackId }) }
  if (docs.cnicFrontReviewId) { at.newFront = images.length; images.push({ src: `/api/documents/${docs.cnicFrontReviewId}/preview`, alt: 'New CNIC front', documentId: docs.cnicFrontReviewId }) }
  if (docs.cnicBackReviewId) { at.newBack = images.length; images.push({ src: `/api/documents/${docs.cnicBackReviewId}/preview`, alt: 'New CNIC back', documentId: docs.cnicBackReviewId }) }
  const hasNew = !!docs.cnicFrontReviewId || !!docs.cnicBackReviewId
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
          {cnicSideNote(!!docs.cnicFrontId, !!docs.cnicBackId) && (
            <p className="text-[11px] font-semibold text-tm-gold-ink">{cnicSideNote(!!docs.cnicFrontId, !!docs.cnicBackId)}</p>
          )}
          {hasNew && (
            <div className="space-y-1 rounded-lg border border-tm-navy/30 bg-tm-tint-navy p-2">
              <p className="text-[11px] font-bold text-tm-navy">New upload — waiting. The approved card above stays on record until you decide.</p>
              <div className="grid grid-cols-2 gap-2">
                {docs.cnicFrontReviewId ? (
                  <Zoomable onOpen={() => setLbIndex(at.newFront)}>
                    <SecureDocumentPreview documentId={docs.cnicFrontReviewId} alt="New CNIC front" />
                  </Zoomable>
                ) : <NoImage label="Front unchanged" />}
                {docs.cnicBackReviewId ? (
                  <Zoomable onOpen={() => setLbIndex(at.newBack)}>
                    <SecureDocumentPreview documentId={docs.cnicBackReviewId} alt="New CNIC back" />
                  </Zoomable>
                ) : <NoImage label="Back unchanged" />}
              </div>
            </div>
          )}
          {/* The typed number sits with the images: checking a card IS comparing the two. */}
          <p className="font-mono text-xs font-black text-tm-navy">
            {docs.cnicNumber ? (
              <CnicShow memberId={docs.parentId} masked={docs.cnicNumber} className="font-mono text-xs font-black text-tm-navy" />
            ) : (
              'No number typed'
            )}
          </p>
          {/* Staff only: the same number on another account (a warning, never a block). */}
          {docs.cnicNumber && <SavedCnicDuplicate memberId={docs.parentId} />}
          {lockable && !hasNew && (
            <UnlockDocButton memberId={docs.parentId} item="cnic" unlockOpen={unlockOpen} canUnlock={canUnlock} />
          )}
        </ReviewItem>

        <ReviewItem parentId={docs.parentId} item="address" title="Home address" canReview={canReview} state={docs.addressItem} whatsapp={docs.whatsapp} onVerified={setVerified}>
          <p className="rounded-xl border border-gray-100 bg-tm-bg p-3 text-xs text-slate-700">
            {docs.address?.trim() ? docs.address : 'No address entered yet.'}
            {docs.city ? <span className="block text-[11px] text-gray-500">City: {docs.city}</span> : null}
          </p>
        </ReviewItem>
      </div>
      <DocumentViewer images={images} index={lbIndex} onIndex={setLbIndex} onClose={() => setLbIndex(null)} />
    </div>
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
  // Approvals are the Owner's alone (owner, 15 Oct 2026); other staff view.
  const ownerApproves = useCanApprove()
  const canReview = canReviewProp && !readOnly && ownerApproves
  const viewOnlyNote = canReviewProp && !ownerApproves && state.hasUpload
  const [status, setStatus] = useState(state.status)
  const [shownReason, setShownReason] = useState(state.reason)
  // The CNIC uses the quick reasons (lib/rejectReasonsCore, owner Part F) and
  // falls back to "This is not the right document."; the typed address keeps
  // its own short list + Other and still needs a reason.
  const quick = item === 'cnic'
  const [chosen, setChosen] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [other, setOther] = useState(false)
  const reason = quick ? buildRejectReason(chosen, note) : (chosen ?? note).trim()
  const setReason = (v: string) => { setChosen(null); setNote(v) }
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [changing, setChanging] = useState(false)

  const s = STATUS_LABEL[status]
  const decided = status === 'approved' || status === 'rejected'
  const what = item === 'cnic' ? 'CNIC photo' : 'address'

  // "Send on WhatsApp" — the rejection message pre-written (staff press send),
  // English + Urdu, with the link to the verification page. Never a CNIC number.
  const waMsisdn = normalisePkMobile(whatsapp)
  const whatsappHref = (() => {
    if (!waMsisdn || reason.length < 3) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tutormint.org'
    const link = `${origin}/parent/verify`
    const text = rejectionWhatsAppText({ what, reason, link, audience: 'parent' })
    return `https://wa.me/${waMsisdn}?text=${encodeURIComponent(text)}`
  })()

  const act = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !quick && reason.length < 3) {
      setRejecting(true)
      toast.error('Choose or write a reason to reject.')
      return
    }
    setBusy(decision)
    const { ok, data } = await adminFetch<{ error?: string; verified?: boolean }>('/api/admin/parents/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, item, decision, reason: decision === 'reject' ? reason || null : null }),
    })
    setBusy(null)
    if (ok) {
      setStatus(decision === 'approve' ? 'approved' : 'rejected')
      setShownReason(decision === 'reject' ? reason : null)
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

      {viewOnlyNote && <OwnerOnlyNote />}

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
              {quick ? (
                <RejectReasonPicker
                  target="cnic"
                  chosen={chosen}
                  onChoose={setChosen}
                  freeText={note}
                  onFreeText={setNote}
                  audience="parent"
                />
              ) : (
              <>
              <div className="flex flex-wrap gap-1">
                {PARENT_REJECT_PRESETS.address.map((p) => (
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
                  value={note}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Reason shown to the parent"
                  className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-tm-red"
                />
              )}
              </>
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
              onClick={() => { setChanging(false); setRejecting(false); setOther(false); setChosen(null); setNote('') }}
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
