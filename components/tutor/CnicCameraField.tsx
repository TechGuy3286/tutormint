'use client'

import { useState, type ReactNode } from 'react'

import { Lock, Clock } from 'lucide-react'
import PhotoCaptureTile from '@/components/tutor/PhotoCaptureTile'
import { compressUnder1MB } from '@/lib/imageCompress'
import { canPick, type LockView } from '@/lib/docLockCore'
import { refreshDocLocks } from '@/lib/useDocLocks'

// The ONE CNIC capture control (PR 3b §2.1, PR22 §3), behind the apply-gate /
// verify flow (TutorVerifyGate), the onboarding CNIC step and the Settings
// identity card — so the three cannot drift.
//
//   * tapping the tile offers "Take a photo" (the camera opens) OR "Choose from
//     gallery" (a plain picker) — the shared PhotoCaptureTile, because a bare
//     `capture=` input forced the camera and blocked an existing photo (§3),
//   * the tile fills with the photo once taken; tap it to retake (no tick, no
//     filename — the photo is the confirmation),
//   * the image is compressed UNDER 1 MB on-device before it is POSTed to
//     /api/documents/upload (kind 'cnic' → the private identity-docs bucket),
//     for BOTH the camera and the gallery path — which clears the serverless
//     body cap that turned a raw camera photo into an opaque "Upload failed".
//
// It never enforces a CNIC-number-first rule itself: the identity card passes a
// `beforeUpload` gate for that; the apply gate does not need one.

export default function CnicCameraField({
  side,
  label,
  urdu,
  storedPreview,
  disabled = false,
  beforeUpload,
  onUploaded,
  onError,
  uploadUrl = '/api/documents/upload',
  uploadExtra,
  lockView = 'open',
}: {
  side: 'front' | 'back'
  label: string
  urdu?: string
  /** A node that renders an already-stored document (e.g. a watermarked preview);
   *  shown until the tutor takes a fresh photo. */
  storedPreview?: ReactNode
  disabled?: boolean
  /** Return false to abort (e.g. the CNIC number is not saved yet). */
  beforeUpload?: () => Promise<boolean> | boolean
  onUploaded?: (documentId: string) => void
  onError?: (message: string) => void
  /** Endpoint override (PR83): the staff CNIC editor points this at the
   *  service-role admin route; members keep the default self-scoped route. */
  uploadUrl?: string
  /** Extra form fields (e.g. the target tutorId + reason on the staff route). */
  uploadExtra?: Record<string, string>
  /** The member's lock on this side (owner, 9 Oct 2026). 'locked' / 'waiting'
   *  show the stored card read-only — no camera, no picker. */
  lockView?: LockView
}) {
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handle(file: File) {
    if (disabled) return
    if (beforeUpload && !(await beforeUpload())) return
    setBusy(true)
    onError?.('')
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData()
      fd.append('kind', 'cnic')
      fd.append('label', side)
      fd.append('file', img)
      if (uploadExtra) for (const [k, v] of Object.entries(uploadExtra)) fd.append(k, v)
      const res = await fetch(uploadUrl, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.documentId) {
        throw new Error(
          json.error ??
            (res.status === 413
              ? 'That photo was too large. Please try again.'
              : `Upload failed (${res.status}).`),
        )
      }
      setLocalPreview((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(img)
      })
      onUploaded?.(json.documentId as string)
      refreshDocLocks()
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'That upload did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const shown: ReactNode = localPreview ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={localPreview} alt={`${label} preview`} className="h-full w-full object-cover" />
  ) : (
    (storedPreview ?? null)
  )
  const done = !!localPreview || storedPreview != null

  if (!canPick(lockView)) {
    // Approved ✓ locked (or a new upload is waiting): the card on record, read
    // only. The full notice sits under both sides (CnicCapture).
    return (
      <div className="min-w-0 flex-1 space-y-1">
        <div className="relative aspect-[1.6] overflow-hidden rounded-xl border border-gray-200 bg-tm-bg">
          {shown}
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-tm-green-deep">
            {lockView === 'waiting' ? <Clock aria-hidden size={11} /> : <Lock aria-hidden size={11} />}
            {lockView === 'waiting' ? 'New upload sent' : 'Approved'}
          </span>
        </div>
        <p className="text-center text-[11px] font-bold text-tm-navy">{label}</p>
      </div>
    )
  }

  return (
    <PhotoCaptureTile
      facingMode="environment"
      aspectClass="aspect-[1.6]"
      label={label}
      urdu={urdu}
      ariaLabel={`the ${side} of your CNIC`}
      disabled={disabled}
      busy={busy}
      done={done}
      preview={shown}
      onPick={(f) => void handle(f)}
    />
  )
}
