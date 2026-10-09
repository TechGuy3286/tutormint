'use client'

import { useState } from 'react'
import { Check, X, Loader2, Maximize2, MessageCircle } from 'lucide-react'
import { normalisePkMobile } from '@/lib/phone'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import Lightbox, { type LightboxImage } from '@/components/admin/Lightbox'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import type { DocumentStatuses, DocItem, DocState } from '@/lib/tutorDocuments'
import { cnicSideNote } from '@/lib/tutorDocQueueCore'

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
  memberWhatsapp,
}: {
  tutorId: string
  canReview: boolean
  avatarUrl: string | null
  cnicFrontId: string | null
  cnicBackId: string | null
  selfieDocId: string | null
  statuses: DocumentStatuses
  /** The member's WhatsApp/phone for the "Send on WhatsApp" rejection message. */
  memberWhatsapp: string | null
}) {
  // PR106-C §3 — the related images, in a fixed order, so the viewer can page
  // CNIC front ↔ back ↔ photo ↔ selfie. Each thumbnail opens the viewer at its
  // index. Only the present images are included.
  const images: LightboxImage[] = []
  const at: Record<string, number> = {}
  if (cnicFrontId) { at.cnicFront = images.length; images.push({ src: `/api/documents/${cnicFrontId}/preview`, alt: 'CNIC front' }) }
  if (cnicBackId) { at.cnicBack = images.length; images.push({ src: `/api/documents/${cnicBackId}/preview`, alt: 'CNIC back' }) }
  if (avatarUrl) { at.pic = images.length; images.push({ src: avatarUrl, alt: 'Profile picture' }) }
  if (selfieDocId) { at.selfie = images.length; images.push({ src: `/api/documents/${selfieDocId}/preview`, alt: 'Selfie' }) }
  const [lbIndex, setLbIndex] = useState<number | null>(null)

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
          memberWhatsapp={memberWhatsapp}
          state={statuses.cnic}
        >
          <div className="grid grid-cols-2 gap-2">
            {cnicFrontId ? (
              <Zoomable onOpen={() => setLbIndex(at.cnicFront)}>
                <SecureDocumentPreview documentId={cnicFrontId} alt="CNIC front" />
              </Zoomable>
            ) : (
              <NoImage label="No front" />
            )}
            {cnicBackId ? (
              <Zoomable onOpen={() => setLbIndex(at.cnicBack)}>
                <SecureDocumentPreview documentId={cnicBackId} alt="CNIC back" />
              </Zoomable>
            ) : (
              <NoImage label="No back" />
            )}
          </div>
          {cnicSideNote(!!cnicFrontId, !!cnicBackId) && (
            <p className="text-[11px] font-semibold text-tm-gold-ink">{cnicSideNote(!!cnicFrontId, !!cnicBackId)}</p>
          )}
        </ReviewItem>

        <ReviewItem
          tutorId={tutorId}
          item="profile_pic"
          title="Profile picture"
          canReview={canReview}
          memberWhatsapp={memberWhatsapp}
          state={statuses.profilePic}
        >
          {avatarUrl ? (
            <Zoomable onOpen={() => setLbIndex(at.pic)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-only review thumbnail */}
              <img src={avatarUrl} alt="Profile picture" className="h-32 w-32 rounded-xl object-cover" />
            </Zoomable>
          ) : (
            <NoImage label="No picture" />
          )}
        </ReviewItem>

        <ReviewItem
          tutorId={tutorId}
          item="selfie"
          title="Selfie"
          canReview={canReview}
          memberWhatsapp={memberWhatsapp}
          state={statuses.selfie}
        >
          {selfieDocId ? (
            <Zoomable onOpen={() => setLbIndex(at.selfie)}>
              <SecureDocumentPreview documentId={selfieDocId} alt="Selfie" />
            </Zoomable>
          ) : (
            <NoImage label="No selfie" />
          )}
        </ReviewItem>
      </div>

      <Lightbox images={images} index={lbIndex} onIndex={setLbIndex} onClose={() => setLbIndex(null)} />
    </section>
  )
}

/** A thumbnail wrapper that opens the admin image viewer on tap/click, with a
 *  small expand hint. Keeps SecureDocumentPreview's own drag/right-click guard. */
function Zoomable({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open larger"
      className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl"
    >
      {children}
      <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-tm-black/55 text-white opacity-80 group-hover:opacity-100">
        <Maximize2 size={14} aria-hidden />
      </span>
    </button>
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
  canReview: canReviewProp,
  state,
  memberWhatsapp,
  children,
}: {
  tutorId: string
  item: DocItem
  title: string
  canReview: boolean
  state: DocState
  memberWhatsapp: string | null
  children: React.ReactNode
}) {
  const toast = useToast()
  // A view-only (Partner) session sees each document and its status, never Approve/Reject.
  const readOnly = useAdminReadOnly()
  const canReview = canReviewProp && !readOnly
  const [status, setStatus] = useState(state.status)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  // PR106-C §7: once a decision is made, the active buttons are hidden behind a
  // "Change decision" link, so an approved/rejected item is not changed by a
  // stray tap. Clicking reveals the buttons again; any change is logged by the
  // route exactly as a first decision is.
  const [changing, setChanging] = useState(false)

  const s = STATUS_LABEL[status]
  const decided = status === 'approved' || status === 'rejected'

  // PR106-H1 §4: "Send on WhatsApp" — opens WhatsApp to the member with the
  // rejection message pre-written (staff press send). English + Urdu, with the
  // re-upload link; NEVER a CNIC number or image.
  const whatName = item === 'cnic' ? 'CNIC photo' : item === 'profile_pic' ? 'profile picture' : 'selfie'
  const waMsisdn = normalisePkMobile(memberWhatsapp)
  const whatsappHref = (() => {
    if (!waMsisdn || reason.trim().length < 3) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tutormint.org'
    const link = `${origin}/tutor/dashboard/settings#identity`
    const en = `Hi, your ${whatName} on TutorMint was not approved: ${reason.trim()} Please upload a clear one here: ${link}`
    const ur = `السلام علیکم، آپ کی ${whatName} منظور نہیں ہوئی: ${reason.trim()} براہِ کرم واضح تصویر یہاں اپلوڈ کریں: ${link}`
    return `https://wa.me/${waMsisdn}?text=${encodeURIComponent(`${en}\n\n${ur}`)}`
  })()

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
      setChanging(false)
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

      {/* PR106-E §3 — no file, nothing to review: show "Not uploaded", no
          Approve/Reject (the server rejects approving a missing file too). */}
      {canReview && !state.hasUpload && (
        <p className="text-[11px] font-semibold text-gray-500">Not uploaded yet — nothing to review.</p>
      )}

      {canReview && state.hasUpload && decided && !changing && (
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="min-h-[32px] text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
        >
          Change decision
        </button>
      )}

      {canReview && state.hasUpload && (!decided || changing) && (
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
              Reject
            </button>
          </div>
          {decided && changing && (
            <button
              type="button"
              onClick={() => { setChanging(false); setRejecting(false); setReason('') }}
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
