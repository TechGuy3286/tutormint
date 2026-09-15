'use client'

import { AlertCircle, BadgeCheck, Clock, IdCard, PencilLine, Send, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import CnicCameraField from '@/components/tutor/CnicCameraField'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import { useToast } from '@/components/ui/Toast'
import { CNIC_FORMAT_HINT, formatCnic, isValidCnic, maskCnic } from '@/lib/cnic'
import { formatDate } from '@/lib/datetime'
import type { Identity } from '@/lib/identity'
import { submitJson } from '@/lib/submit'

// The identity card. ONE component, both roles.
//
// WHAT IT REPLACED, and why one component rather than two. A parent's CNIC
// lived on /parent/verify and went through /api/documents/upload into the
// PRIVATE identity-docs bucket, watermarked, served only through an
// authorising route. A tutor's lived in a section of the settings page headed
// "ANTI-DOWNLOAD PROTECTED DOCUMENTS" and went, through the same helper the
// avatar used, into the PUBLIC tutor-media bucket — where the front and back
// of two real members' national identity cards were fetchable by anyone with
// the URL and no credential of any kind. The heading was the only protection
// in the feature.
//
// Two flows for one document is how that happens. There is one now, it is the
// parent one, and the tutor settings page renders this card instead.
//
// THE CARD IS THE FORM. Not a card with a link to a form: verification is a
// one-time chore that people abandon halfway, and every hop between "here is
// what we hold" and "here is what is missing" is somewhere to abandon it. The
// same component shows a verified card, a pending one, a rejected one, and an
// empty one that can be filled in place.
//
// THE NUMBER COMES FIRST, and the images cannot be submitted without it. Not
// an arbitrary ordering: an admin checking a card compares the typed number
// against the photograph, and a queue entry with two images and no number
// cannot be actioned at all — it goes back to the member, days later, for a
// field they could have filled in the same minute.
//
// WHAT IS SHOWN BACK is masked (42101-*****-2, see lib/cnic.ts) and the images
// are watermarked previews from /api/documents/[id]/preview. Neither the full
// number nor an original ever reaches the browser after it has been submitted.

type Props = {
  identity: Identity
  /** Only used for wording: what this verification unlocks differs by role. */
  role: 'tutor' | 'parent'
}

const CONSEQUENCE: Record<Props['role'], string> = {
  parent:
    'Your CNIC is checked once. Until it is approved you cannot post a tuition, message a tutor or request a demo.',
  tutor:
    'Your CNIC is checked once, and it is part of what makes your profile a verified one. Only you and our verification team can see it.',
}

export default function IdentityCard({ identity, role }: Props) {
  const router = useRouter()
  const toast = useToast()

  const [number, setNumber] = useState(identity.cnicNumber ?? '')
  const [front, setFront] = useState(identity.front)
  const [back, setBack] = useState(identity.back)
  const [state, setState] = useState(identity.state)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // "Request a change" on an approved card. Held in state rather than routed
  // to, so the member never leaves the page they were reading.
  const [editing, setEditing] = useState(false)

  const masked = maskCnic(identity.cnicNumber)
  const numberSaved = isValidCnic(identity.cnicNumber)
  const showForm = editing || state === 'none' || state === 'rejected'

  async function saveNumber() {
    setBusy(true)
    setError('')
    setNotice('')
    const { ok, error: failed } = await submitJson('/api/identity', {
      action: 'save-number',
      cnicNumber: number,
    })
    setBusy(false)
    if (!ok) {
      setError(failed ?? CNIC_FORMAT_HINT)
      toast.error(failed ?? CNIC_FORMAT_HINT)
      return false
    }
    setNotice('CNIC number saved.')
    toast.success('CNIC number saved.')
    router.refresh()
    return true
  }

  // A stored identity document is REPLACED, never removed — the file is
  // retained privately either way, and "delete then re-upload before you can
  // submit" is a worse flow than replacing in place. So there is no remove
  // path here (and none in /api/identity): Replace is the only action.

  // The number gates the images, and it is enforced here as well as in the
  // submit route: uploading a national identity document is not something to let
  // somebody do and then tell them it did not count. Returns false to abort the
  // capture (CnicCameraField's beforeUpload contract).
  async function ensureNumber(): Promise<boolean> {
    setError('')
    if (!isValidCnic(number)) {
      setError('Add your CNIC number first — it has to match the card in the photo.')
      return false
    }
    if (!numberSaved && !(await saveNumber())) return false
    return true
  }

  function onUploaded(side: 'front' | 'back', documentId: string) {
    const doc = { id: documentId, side, uploadedAt: new Date().toISOString() }
    if (side === 'back') setBack(doc)
    else setFront(doc)
    setError('')
    setNotice(`${side === 'back' ? 'Back' : 'Front'} of your card uploaded.`)
    toast.success(`${side === 'back' ? 'Back' : 'Front'} of your card uploaded.`)
    router.refresh()
  }

  async function submit() {
    if (!numberSaved && !(await saveNumber())) return
    setBusy(true)
    setError('')
    const { ok, error: failed } = await submitJson('/api/identity', { action: 'submit' })
    setBusy(false)
    if (!ok) {
      setError(failed ?? 'Could not submit that.')
      toast.error(failed ?? 'Could not submit that.')
      return
    }
    setState('submitted')
    setEditing(false)
    setNotice('Sent for checking.')
    toast.success('Sent for checking.')
    router.refresh()
  }

  async function reopen() {
    setBusy(true)
    setError('')
    const { ok, error: failed } = await submitJson('/api/identity', { action: 'reopen' })
    setBusy(false)
    if (!ok) {
      setError(failed ?? 'Could not reopen that.')
      toast.error(failed ?? 'Could not reopen that.')
      return
    }
    setState('none')
    setEditing(true)
    setNotice('Replace whichever side has changed, then send it again.')
    toast.success('You can replace a side and send it again.')
    router.refresh()
  }

  const canSubmit = isValidCnic(number) && !!front && !!back && !busy

  return (
    <section
      id="cnic"
      aria-labelledby="identity-card"
      className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="identity-card"
          className="flex items-center gap-2 text-xs font-black text-tm-navy"
        >
          <IdCard aria-hidden size={15} className="text-gray-500" />
          Identity documents
        </h2>
        <StatusChip state={state} />
      </div>

      {/* ------------------------------------------------------- the facts -- */}
      {masked && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div>
            <dt className="text-[10px] font-black uppercase tracking-wider text-gray-500">
              CNIC number
            </dt>
            <dd className="font-mono text-xs font-bold text-tm-navy">{masked}</dd>
          </div>
          {identity.verifiedAt && (
            <div>
              <dt className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                Verified
              </dt>
              <dd className="text-xs font-bold text-tm-green-deep">
                {formatDate(identity.verifiedAt)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {state === 'rejected' && identity.rejectionReason && (
        <p className="flex items-start gap-1.5 rounded-xl bg-tm-tint-red p-2.5 text-[11px] font-semibold leading-relaxed text-tm-red-hover">
          <AlertCircle aria-hidden size={13} className="mt-px shrink-0" />
          {identity.rejectionReason}
        </p>
      )}

      {/* --------------------------------------------------- the two sides -- */}
      {showForm ? (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-gray-500">{CONSEQUENCE[role]}</p>

          <div className="space-y-1">
            <label htmlFor="cnic-number" className="text-[11px] font-bold text-tm-navy">
              CNIC number
            </label>
            <div className="flex gap-2">
              <input
                id="cnic-number"
                value={number}
                inputMode="numeric"
                autoComplete="off"
                placeholder="42101-1234567-1"
                // Normalised as it is typed, so the dashes appear whether or
                // not the member puts them in and the stored form is the same
                // either way.
                onChange={(e) => setNumber(formatCnic(e.target.value))}
                className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-white px-3 font-mono text-xs outline-none focus:border-tm-navy"
              />
              <button
                type="button"
                onClick={() => void saveNumber()}
                disabled={busy || !isValidCnic(number)}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-50"
              >
                <PencilLine aria-hidden size={13} />
                Save
              </button>
            </div>
            <p className="text-[11px] text-gray-500">{CNIC_FORMAT_HINT}</p>
          </div>

          {/* The SHARED CNIC capture (PR 3b §2.1) — same camera-first control as
              the apply-gate modal: tap opens the camera, the tile fills with the
              photo, tap to retake, compressed under 1 MB. */}
          <div className="flex gap-3">
            <CnicCameraField
              side="front"
              label="Front CNIC"
              disabled={!isValidCnic(number)}
              beforeUpload={ensureNumber}
              onUploaded={(id) => onUploaded('front', id)}
              onError={(m) => setError(m)}
              storedPreview={
                front ? <SecureDocumentPreview documentId={front.id} alt="Front CNIC" /> : undefined
              }
            />
            <CnicCameraField
              side="back"
              label="Back CNIC"
              disabled={!isValidCnic(number)}
              beforeUpload={ensureNumber}
              onUploaded={(id) => onUploaded('back', id)}
              onError={(m) => setError(m)}
              storedPreview={
                back ? <SecureDocumentPreview documentId={back.id} alt="Back CNIC" /> : undefined
              }
            />
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">
            Take a clear photo of each side — all four corners in frame and the text readable.
          </p>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto"
          >
            <Send aria-hidden size={14} />
            Send for checking
          </button>
          {!canSubmit && !busy && (
            <p className="text-[11px] text-gray-500">
              {!isValidCnic(number)
                ? 'Add your CNIC number to continue.'
                : !front || !back
                  ? 'Both sides of the card are needed.'
                  : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Thumb doc={front} label="Front CNIC" />
            <Thumb doc={back} label="Back CNIC" />
          </div>

          {state === 'submitted' ? (
            <p className="text-[11px] leading-relaxed text-gray-500">
              Our team is checking these, usually within a few hours. Nothing else is needed from
              you.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void reopen()}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-50"
            >
              <Upload aria-hidden size={13} />
              Request a change
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-xl bg-tm-tint-red p-2.5 text-[11px] font-semibold text-tm-red-hover"
        >
          <AlertCircle aria-hidden size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="rounded-xl bg-tm-tint-green p-2.5 text-[11px] font-semibold text-tm-green-deep">
          {notice}
        </p>
      )}
    </section>
  )
}

function Thumb({ doc, label }: { doc: { id: string } | null; label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">{label}</p>
      {doc ? (
        <SecureDocumentPreview documentId={doc.id} alt={label} />
      ) : (
        <p className="grid min-h-[72px] place-items-center rounded-xl border border-dashed border-gray-200 bg-tm-bg text-[11px] font-bold text-gray-500">
          Not uploaded
        </p>
      )}
    </div>
  )
}

function StatusChip({ state }: { state: Identity['state'] }) {
  if (state === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-green px-2.5 py-1 text-[10px] font-black text-tm-green-deep">
        <BadgeCheck aria-hidden size={12} />
        Verified
      </span>
    )
  }
  if (state === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-gold px-2.5 py-1 text-[10px] font-black text-tm-gold-ink">
        <Clock aria-hidden size={12} />
        Being checked
      </span>
    )
  }
  if (state === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-red px-2.5 py-1 text-[10px] font-black text-tm-red-hover">
        <AlertCircle aria-hidden size={12} />
        Not accepted
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tm-bg px-2.5 py-1 text-[10px] font-black text-gray-500">
      Not verified
    </span>
  )
}
