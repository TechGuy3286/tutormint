'use client'

import { AlertCircle, BadgeCheck, Clock, IdCard, PencilLine, Send, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import FileUpload from '@/components/FileUpload'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import { CNIC_FORMAT_HINT, formatCnic, isValidCnic, maskCnic } from '@/lib/cnic'
import { formatDate } from '@/lib/datetime'
import type { Identity } from '@/lib/identity'
import { UPLOAD_TIMEOUT_MS, submitError, submitJson, submitSignal } from '@/lib/submit'

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
      return false
    }
    setNotice('CNIC number saved.')
    router.refresh()
    return true
  }

  async function upload(file: File, side: 'front' | 'back') {
    setError('')
    // The number gates the images, and it is enforced here as well as in the
    // submit route: uploading a national identity document is not something to
    // let somebody do and then tell them it did not count.
    if (!isValidCnic(number)) {
      setError('Add your CNIC number first — it has to match the card in the photo.')
      throw new Error('number required')
    }
    if (!numberSaved && !(await saveNumber())) throw new Error('number not saved')

    const fd = new FormData()
    fd.append('kind', 'cnic')
    fd.append('file', file)
    fd.append('label', side)

    // Not submitJson: FormData, and a phone on a slow connection legitimately
    // needs longer than the ten-second default.
    let json: { documentId?: string; error?: string } = {}
    let ok = false
    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: fd,
        signal: submitSignal(UPLOAD_TIMEOUT_MS),
      })
      json = await res.json().catch(() => ({}))
      ok = res.ok
    } catch (e) {
      json = { error: submitError(e, 'That upload did not go through.') }
    }

    if (!ok || !json.documentId) {
      const message = json.error ?? 'That upload did not go through.'
      setError(message)
      throw new Error(message)
    }

    const doc = { id: json.documentId, side, uploadedAt: new Date().toISOString() }
    if (side === 'back') setBack(doc)
    else setFront(doc)
    setNotice(`${side === 'back' ? 'Back' : 'Front'} of your card uploaded.`)
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
      return
    }
    setState('submitted')
    setEditing(false)
    setNotice('Sent for checking.')
    router.refresh()
  }

  async function reopen() {
    setBusy(true)
    setError('')
    const { ok, error: failed } = await submitJson('/api/identity', { action: 'reopen' })
    setBusy(false)
    if (!ok) {
      setError(failed ?? 'Could not reopen that.')
      return
    }
    setState('none')
    setEditing(true)
    setNotice('Replace whichever side has changed, then send it again.')
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FileUpload
              label="Front of your CNIC"
              acceptLabel="JPG or PNG"
              hint="All four corners in frame, and the text readable."
              disabled={!isValidCnic(number)}
              onFile={(f) => upload(f, 'front')}
              currentPreview={
                front ? (
                  <SecureDocumentPreview documentId={front.id} alt="Front of your CNIC" />
                ) : undefined
              }
            />
            <FileUpload
              label="Back of your CNIC"
              acceptLabel="JPG or PNG"
              hint="The side with the address and the expiry date."
              disabled={!isValidCnic(number)}
              onFile={(f) => upload(f, 'back')}
              currentPreview={
                back ? (
                  <SecureDocumentPreview documentId={back.id} alt="Back of your CNIC" />
                ) : undefined
              }
            />
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto"
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
            <Thumb doc={front} label="Front" />
            <Thumb doc={back} label="Back" />
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
        <SecureDocumentPreview documentId={doc.id} alt={`${label} of your CNIC`} />
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
