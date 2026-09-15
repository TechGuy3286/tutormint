'use client'

import { Camera, Loader2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { compressImage } from '@/lib/imageCompress'

// The ONE CNIC capture control (PR 3b §2.1), behind both the apply-gate modal
// (TutorVerifyGate) and the Settings identity card — so the two cannot drift.
//
//   * the camera opens directly (accept="image/*" capture="environment"),
//   * the tile fills with the photo once taken; tap it to retake (no tick, no
//     filename — the photo is the confirmation),
//   * the image is compressed UNDER 1 MB on-device before it is POSTed to
//     /api/documents/upload (kind 'cnic' → the private identity-docs bucket),
//     which clears the serverless body cap that turned a raw camera photo into an
//     opaque "Upload failed".
//
// It never enforces a CNIC-number-first rule itself: the identity card passes a
// `beforeUpload` gate for that; the apply gate does not need one.

/** Compress until under 1 MB (PR 3b §2.1), stepping quality down for a very large
 *  photo; falls back to the best effort rather than blocking the upload. */
async function compressUnder1MB(file: File): Promise<File> {
  let out = await compressImage(file, { maxEdge: 1400, quality: 0.8 })
  let quality = 0.7
  while (out.size > 1024 * 1024 && quality >= 0.4) {
    out = await compressImage(file, { maxEdge: 1200, quality })
    quality -= 0.15
  }
  return out
}

export default function CnicCameraField({
  side,
  label,
  urdu,
  storedPreview,
  disabled = false,
  beforeUpload,
  onUploaded,
  onError,
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
}) {
  const ref = useRef<HTMLInputElement>(null)
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
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
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

  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => ref.current?.click()}
        className={`relative grid aspect-[1.6] w-full place-items-center overflow-hidden rounded-xl border-2 disabled:opacity-60 ${
          done ? 'border-tm-green-deep' : 'border-dashed border-gray-300 bg-white'
        }`}
        aria-label={`${done ? 'Retake' : 'Take a photo of'} the ${side} of your CNIC`}
      >
        {shown ?? <Camera size={22} className="text-gray-500" aria-hidden />}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-tm-black/40">
            <Loader2 size={20} className="animate-spin text-white" aria-hidden />
          </span>
        )}
      </button>
      <span className="flex flex-col items-center leading-tight">
        <span className="text-[11px] font-bold text-tm-navy">{label}</span>
        {urdu && (
          <span className="text-[10px] text-gray-500" lang="ur" dir="rtl">
            {urdu}
          </span>
        )}
      </span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handle(f)
        }}
      />
    </div>
  )
}
