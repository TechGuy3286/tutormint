'use client'

import { useState } from 'react'
import { Check, X, Loader2, MessageCircle } from 'lucide-react'
import { normalisePkMobile } from '@/lib/phone'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import DocumentViewer, { ViewerThumb as Zoomable, type ViewerImage } from '@/components/admin/DocumentViewer'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { OwnerOnlyNote, useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import type { DocumentStatuses, DocItem, DocState } from '@/lib/tutorDocuments'
import { cnicSideNote } from '@/lib/tutorDocQueueCore'
import { CNIC_NUMBER_MISSING } from '@/lib/docLockCore'
import { UnlockedNote, useUnlockDoc } from '@/components/admin/UnlockDocButton'
import DocChangeMenu from '@/components/admin/DocChangeMenu'
import { changeMenuOptions } from '@/lib/docChangeMenuCore'
import AdminCnicNumberBox, { CNIC_NUMBER_BOX_ID } from '@/components/admin/AdminCnicNumberBox'
import DocumentsApprovedWhatsApp from '@/components/admin/DocumentsApprovedWhatsApp'
import { allDocumentsApproved } from '@/lib/documentsApprovedCore'
import RejectReasonPicker from '@/components/admin/RejectReasonPicker'
import SelfieMatchWarning from '@/components/admin/SelfieMatchWarning'
import { buildRejectReason, rejectionWhatsAppText, type RejectTarget } from '@/lib/rejectReasonsCore'

/** The admin lock facts for the card (lib/docLocks loadAdminLockInfo). */
export type ReviewLockInfo = {
  review: { cnicFrontId: string | null; cnicBackId: string | null; selfieId: string | null }
  unlockOpen: { cnic: boolean; selfie: boolean; photo?: boolean }
  lockable: { cnic: boolean; selfie: boolean; photo?: boolean }
}

// Per-item identity review (PR60): CNIC front/back, profile picture and selfie
// side by side, each approved or rejected on its own. A reject carries a reason:
// one of the quick reasons (lib/rejectReasonsCore REJECT_REASONS) and/or free
// text; with neither, the fallback "This is not the right document." This
// changes NO listing rule.

const REJECT_TARGET: Record<DocItem, RejectTarget> = { cnic: 'cnic', profile_pic: 'photo', selfie: 'selfie' }

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
  avatarOriginalUrl = null,
  cnicFrontId,
  cnicBackId,
  selfieDocId,
  statuses,
  memberWhatsapp,
  lockInfo,
  canUnlock = false,
  cnicNumberMasked = null,
  canEditNumber = false,
  selfieLooksLikePhoto = false,
}: {
  tutorId: string
  canReview: boolean
  avatarUrl: string | null
  /** The photo as the member uploaded it, when the one in use is a cropped or
   *  turned copy (lib/avatarCrop avatarOriginalUrl). */
  avatarOriginalUrl?: string | null
  cnicFrontId: string | null
  cnicBackId: string | null
  selfieDocId: string | null
  statuses: DocumentStatuses
  /** The member's WhatsApp/phone for the "Send on WhatsApp" rejection message. */
  memberWhatsapp: string | null
  /** Approved-document locks (owner, 9 Oct 2026): waiting re-uploads, open
   *  unlocks, and which documents can be unlocked. */
  lockInfo?: ReviewLockInfo
  /** Owner, admin, operations may unlock (SCREEN_ACCESS.documentUnlock). */
  canUnlock?: boolean
  /** XXXXX-XXXXXXX-4, or null when no CNIC number is on file. */
  cnicNumberMasked?: string | null
  /** Staff who may type the CNIC number here (SCREEN_ACCESS.tutorEdit). */
  canEditNumber?: boolean
  /** The selfie looks the same as the profile picture (lib/selfieMatch) — a warning only. */
  selfieLooksLikePhoto?: boolean
}) {
  const [numberHighlight, setNumberHighlight] = useState(false)
  // Each item's status as it changes on this card, so "Send WhatsApp" appears
  // the moment the last of the three is approved (owner, 15 Oct 2026).
  const [live, setLive] = useState({ cnic: statuses.cnic.status, profilePic: statuses.profilePic.status, selfie: statuses.selfie.status })
  const readOnlyCard = useAdminReadOnly()
  const rv = lockInfo?.review
  // PR106-C §3 — the related images, in a fixed order, so the viewer can page
  // CNIC front ↔ back ↔ photo ↔ selfie. Each thumbnail opens the viewer at its
  // index. Only the present images are included.
  const images: ViewerImage[] = []
  const at: Record<string, number> = {}
  if (cnicFrontId) { at.cnicFront = images.length; images.push({ src: `/api/documents/${cnicFrontId}/preview`, alt: 'CNIC front', documentId: cnicFrontId }) }
  if (cnicBackId) { at.cnicBack = images.length; images.push({ src: `/api/documents/${cnicBackId}/preview`, alt: 'CNIC back', documentId: cnicBackId }) }
  // The expand icon opens the ORIGINAL upload (owner, 20 Oct 2026) — the
  // picture as uploaded, turned by any saved rotation, never the crop.
  if (avatarUrl) { at.pic = images.length; images.push({ src: avatarOriginalUrl ? `/api/admin/profile-photo/source?memberId=${tutorId}` : avatarUrl, alt: 'Profile picture', profileId: tutorId }) }
  if (selfieDocId) { at.selfie = images.length; images.push({ src: `/api/documents/${selfieDocId}/preview`, alt: 'Selfie', documentId: selfieDocId }) }
  if (rv?.cnicFrontId) { at.newFront = images.length; images.push({ src: `/api/documents/${rv.cnicFrontId}/preview`, alt: 'New CNIC front', documentId: rv.cnicFrontId }) }
  if (rv?.cnicBackId) { at.newBack = images.length; images.push({ src: `/api/documents/${rv.cnicBackId}/preview`, alt: 'New CNIC back', documentId: rv.cnicBackId }) }
  if (rv?.selfieId) { at.newSelfie = images.length; images.push({ src: `/api/documents/${rv.selfieId}/preview`, alt: 'New selfie', documentId: rv.selfieId }) }
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
          unlock={lockInfo ? { item: 'cnic', lockable: lockInfo.lockable.cnic && !rv?.cnicFrontId && !rv?.cnicBackId, unlockOpen: lockInfo.unlockOpen.cnic, canUnlock } : null}
          onStatus={(st) => setLive((l) => ({ ...l, cnic: st }))}
          onNumberMissing={() => {
            setNumberHighlight(true)
            const box = document.getElementById(CNIC_NUMBER_BOX_ID)
            box?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            box?.querySelector('input')?.focus()
          }}
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
          {(rv?.cnicFrontId || rv?.cnicBackId) && (
            <NewUpload>
              <div className="grid grid-cols-2 gap-2">
                {rv?.cnicFrontId ? (
                  <Zoomable onOpen={() => setLbIndex(at.newFront)}>
                    <SecureDocumentPreview documentId={rv.cnicFrontId} alt="New CNIC front" />
                  </Zoomable>
                ) : <NoImage label="Front unchanged" />}
                {rv?.cnicBackId ? (
                  <Zoomable onOpen={() => setLbIndex(at.newBack)}>
                    <SecureDocumentPreview documentId={rv.cnicBackId} alt="New CNIC back" />
                  </Zoomable>
                ) : <NoImage label="Back unchanged" />}
              </div>
            </NewUpload>
          )}
          <AdminCnicNumberBox tutorId={tutorId} maskedNumber={cnicNumberMasked} canEdit={canEditNumber} highlight={numberHighlight} hasFrontPhoto={!!(cnicFrontId || rv?.cnicFrontId)} />
        </ReviewItem>

        <ReviewItem
          tutorId={tutorId}
          item="profile_pic"
          title="Profile picture"
          canReview={canReview}
          memberWhatsapp={memberWhatsapp}
          state={statuses.profilePic}
          unlock={lockInfo ? { item: 'photo', lockable: !!lockInfo.lockable.photo, unlockOpen: !!lockInfo.unlockOpen.photo, canUnlock } : null}
          onStatus={(st) => setLive((l) => ({ ...l, profilePic: st }))}
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
          unlock={lockInfo ? { item: 'selfie', lockable: lockInfo.lockable.selfie && !rv?.selfieId, unlockOpen: lockInfo.unlockOpen.selfie, canUnlock } : null}
          onStatus={(st) => setLive((l) => ({ ...l, selfie: st }))}
        >
          {selfieLooksLikePhoto && <SelfieMatchWarning />}
          {selfieDocId ? (
            <Zoomable onOpen={() => setLbIndex(at.selfie)}>
              <SecureDocumentPreview documentId={selfieDocId} alt="Selfie" />
            </Zoomable>
          ) : (
            <NoImage label="No selfie" />
          )}
          {rv?.selfieId && (
            <NewUpload>
              <Zoomable onOpen={() => setLbIndex(at.newSelfie)}>
                <SecureDocumentPreview documentId={rv.selfieId} alt="New selfie" />
              </Zoomable>
            </NewUpload>
          )}
        </ReviewItem>
      </div>

      {canReview && !readOnlyCard && allDocumentsApproved(live) && <DocumentsApprovedWhatsApp tutorId={tutorId} />}

      <DocumentViewer images={images} index={lbIndex} onIndex={setLbIndex} onClose={() => setLbIndex(null)} />
    </section>
  )
}

/** A new upload of an approved document, waiting for this decision. */
function NewUpload({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border border-tm-navy/30 bg-tm-tint-navy p-2">
      <p className="text-[11px] font-bold text-tm-navy">New upload — waiting. The approved one above stays on record until you decide.</p>
      {children}
    </div>
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
  onNumberMissing,
  onStatus,
  unlock = null,
  children,
}: {
  /** Unlock for re-upload, offered in the Change menu when the document is approved and locked. */
  unlock?: { item: 'cnic' | 'selfie' | 'photo'; lockable: boolean; unlockOpen: boolean; canUnlock: boolean } | null
  tutorId: string
  item: DocItem
  title: string
  canReview: boolean
  state: DocState
  memberWhatsapp: string | null
  /** Approve was refused because the CNIC number is missing. */
  onNumberMissing?: () => void
  /** Tells the card this item's status changed. */
  onStatus?: (status: DocState['status']) => void
  children: React.ReactNode
}) {
  const toast = useToast()
  // A view-only (Partner) session sees each document and its status, never Approve/Reject.
  const readOnly = useAdminReadOnly()
  // Approvals are the Owner's alone (owner, 15 Oct 2026); other staff view.
  const ownerApproves = useCanApprove()
  const canReview = canReviewProp && !readOnly && ownerApproves
  const viewOnlyNote = canReviewProp && !ownerApproves && state.hasUpload
  const [status, setStatus] = useState(state.status)
  const [shownReason, setShownReason] = useState(state.reason)
  const [chosen, setChosen] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // The text the tutor will see (in-app, email, WhatsApp): the tapped reason
  // and/or the note, else the fallback.
  const reason = buildRejectReason(chosen, note)
  const clearReason = () => { setChosen(null); setNote('') }
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  // PR106-C §7: once a decision is made, the active buttons are hidden behind
  // the "Change ▾" menu (owner, 20 Oct 2026), so an approved/rejected item is
  // not changed by a stray tap; any change is logged by the route exactly as a
  // first decision is.
  const [changing, setChanging] = useState(false)

  const unlocker = useUnlockDoc(tutorId, unlock?.item ?? 'cnic', !!unlock?.unlockOpen)
  const s = STATUS_LABEL[status]
  const decided = status === 'approved' || status === 'rejected'
  // One Change menu (owner, 20 Oct 2026) — Owner only, lib/docChangeMenuCore.
  const menu = changeMenuOptions({
    canDecide: canReview,
    status,
    hasUpload: state.hasUpload,
    unlockable: !!unlock?.lockable,
    unlockOpen: unlocker.open,
    canUnlock: !!unlock?.canUnlock,
  })

  // PR106-H1 §4: "Send on WhatsApp" — opens WhatsApp to the member with the
  // rejection message pre-written (staff press send). English + Urdu, with the
  // re-upload link; NEVER a CNIC number or image.
  const whatName = item === 'cnic' ? 'CNIC photo' : item === 'profile_pic' ? 'profile picture' : 'selfie'
  const waMsisdn = normalisePkMobile(memberWhatsapp)
  const whatsappHref = (() => {
    if (!waMsisdn) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tutormint.org'
    const link = `${origin}/tutor/dashboard/settings#identity`
    const text = rejectionWhatsAppText({ what: whatName, reason, link, audience: 'tutor' })
    return `https://wa.me/${waMsisdn}?text=${encodeURIComponent(text)}`
  })()

  const act = async (decision: 'approve' | 'reject') => {
    setBusy(decision)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/tutors/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId, item, decision, reason: decision === 'reject' ? reason : null }),
    })
    setBusy(null)
    if (ok) {
      setStatus(decision === 'approve' ? 'approved' : 'rejected')
      onStatus?.(decision === 'approve' ? 'approved' : 'rejected')
      setShownReason(decision === 'reject' ? reason : null)
      setRejecting(false)
      clearReason()
      setChanging(false)
      toast.success(decision === 'approve' ? 'Approved. The tutor was notified.' : 'Rejected. The tutor was notified.')
    } else {
      toast.error(data?.error ?? 'Could not save that.')
      if (data?.error === CNIC_NUMBER_MISSING) onNumberMissing?.()
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-black text-tm-navy">{title}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>
          {state.rereview && status === 'pending' ? (item === 'profile_pic' ? 'Changed photo — waiting' : 'New upload — waiting') : s.text}
        </span>
      </div>
      {children}
      {shownReason && status === 'rejected' && (
        <p className="text-[11px] text-tm-red">{shownReason}</p>
      )}

      {viewOnlyNote && <OwnerOnlyNote />}

      {/* PR106-E §3 — no file, nothing to review: show "Not uploaded", no
          Approve/Reject (the server rejects approving a missing file too). */}
      {canReview && !state.hasUpload && (
        <p className="text-[11px] font-semibold text-gray-500">Not uploaded yet — nothing to review.</p>
      )}

      {unlock && unlocker.open && <UnlockedNote />}

      {decided && !changing && (
        <DocChangeMenu
          options={menu}
          busy={!!busy || unlocker.busy}
          onPick={(o) => {
            if (o === 'approve') void act('approve')
            else if (o === 'reject') {
              setChanging(true)
              setRejecting(true)
            } else void unlocker.run()
          }}
        />
      )}

      {canReview && state.hasUpload && (!decided || changing) && (
        <div className="space-y-2">
          {rejecting && (
            <div className="space-y-1">
              <RejectReasonPicker
                target={REJECT_TARGET[item]}
                chosen={chosen}
                onChoose={setChosen}
                freeText={note}
                onFreeText={setNote}
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
              {rejecting ? 'Confirm reject' : 'Reject'}
            </button>
          </div>
          {decided && changing && (
            <button
              type="button"
              onClick={() => { setChanging(false); setRejecting(false); clearReason() }}
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
