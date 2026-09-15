'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2 } from 'lucide-react'

import { compressImage } from '@/lib/imageCompress'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'

// The verification gate an UNVERIFIED tutor meets when they tap Apply (owner,
// 15 Sep 2026). Deliberately minimal — a tutor on a phone does not read paragraphs:
//
//   * one line ("Upload your CNIC, front and back."),
//   * CNIC FRONT and BACK inline — two camera opens (capture=environment), each
//     filling with the actual photo once taken, tappable to retake (no tick, no
//     filename),
//   * one small privacy line, the one permitted claim, and two buttons.
//
// The images save to the tutor's profile automatically (POST /api/documents/upload,
// kind 'cnic' — the private identity-docs bucket; never re-uploaded elsewhere,
// never shown publicly). "Verify" routes to the payment page and does nothing
// else — NO price here, and NO claim that verifying wins tuitions, applications,
// replies or income. The ONLY permitted outcome language is the exact line
// "Verified tutors are shown to parents first." (visibility, which survives a
// tutor who pays and is not hired — there are no refunds).

type Side = 'front' | 'back'

function CnicTile({
  side,
  label,
  urdu,
  done,
  preview,
  busy,
  onFile,
}: {
  side: Side
  label: string
  urdu: string
  done: boolean
  preview: string | null
  busy: boolean
  onFile: (side: Side, file: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className={`relative grid aspect-[1.6] w-full place-items-center overflow-hidden rounded-xl border-2 disabled:opacity-60 ${
          done ? 'border-tm-green-deep' : 'border-dashed border-gray-300 bg-white'
        }`}
        aria-label={`${done ? 'Retake' : 'Take a photo of'} the ${side} of your CNIC`}
      >
        {preview ? (
          // The actual photo fills the box — the confirmation is the photo, so
          // there is no tick overlay (owner, 15 Sep). Tap it to retake.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`${label} preview`} className="h-full w-full object-cover" />
        ) : (
          <Camera size={22} className="text-gray-500" aria-hidden />
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-tm-black/40">
            <Loader2 size={20} className="animate-spin text-white" aria-hidden />
          </span>
        )}
      </button>
      <span className="flex flex-col items-center leading-tight">
        <span className="text-[11px] font-bold text-tm-navy">{label}</span>
        <span className="text-[10px] text-gray-500" lang="ur" dir="rtl">
          {urdu}
        </span>
      </span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(side, f)
        }}
      />
    </div>
  )
}

export default function TutorVerifyGate({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [preview, setPreview] = useState<{ front: string | null; back: string | null }>({
    front: null,
    back: null,
  })
  const [uploading, setUploading] = useState<Side | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [stuck, setStuck] = useState<string | null>(null)

  const both = !!preview.front && !!preview.back

  async function uploadSide(side: Side, file: File) {
    setUploading(side)
    setError(null)
    try {
      // Compress on-device so the multi-MB camera photo clears the API route's
      // ~4.5 MB request-body cap (the same fix as the selfie upload).
      const img = await compressImage(file)
      const fd = new FormData()
      fd.append('kind', 'cnic')
      fd.append('label', side)
      fd.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          json.error ??
            (res.status === 413 ? 'That photo was too large. Please try again.' : `Upload failed (${res.status}).`),
        )
      }
      setPreview((p) => {
        const old = p[side]
        if (old) URL.revokeObjectURL(old)
        return { ...p, [side]: URL.createObjectURL(img) }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That upload did not go through.')
    } finally {
      setUploading(null)
    }
  }

  async function verify() {
    setStarting(true)
    setError(null)
    // The one-time fee is a checkout for the 'verified' fee marker (Rs 199).
    const { ok, data, error: failed } = await submitJson<{ mode?: string; url?: string; next?: string }>(
      '/api/payments/checkout',
      { planCode: 'verified' },
    )
    if (!ok || !data) {
      setError(failed ?? 'Could not start the payment.')
      setStarting(false)
      return
    }
    const target = data.mode === 'redirect' ? (data.url ?? '') : (data.next ?? '')
    if (!target) {
      setError('Could not start the payment.')
      setStarting(false)
      return
    }
    armEscape(() => {
      setStarting(false)
      setStuck(target)
      setError(STUCK_MESSAGE)
    })
    if (data.mode === 'redirect') {
      window.location.assign(target)
      return
    }
    router.push(target)
  }

  return (
    <div className="mt-3 space-y-4">
      {/* One line — what to do. Nothing about what verification is, or the fee. */}
      <p className="flex flex-col leading-tight">
        <span className="text-xs font-semibold text-slate-700">Upload your CNIC, front and back.</span>
        <span className="text-[11px] text-gray-500" lang="ur" dir="rtl">
          اپنا شناختی کارڈ اپلوڈ کریں — سامنے اور پیچھے
        </span>
      </p>

      {/* Front + back, side by side. Each fills with the real photo once taken. */}
      <div className="flex gap-3">
        <CnicTile
          side="front"
          label="Front"
          urdu="سامنے کا رخ"
          done={!!preview.front}
          preview={preview.front}
          busy={uploading === 'front'}
          onFile={uploadSide}
        />
        <CnicTile
          side="back"
          label="Back"
          urdu="پچھلا رخ"
          done={!!preview.back}
          preview={preview.back}
          busy={uploading === 'back'}
          onFile={uploadSide}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Only our verification team sees it. Never on your profile.
      </p>

      {/* The one permitted claim — visibility, never an outcome promise. */}
      <p className="flex flex-col gap-0.5 rounded-xl bg-tm-tint-green p-3 leading-tight text-tm-green-deep">
        <span className="text-xs font-bold">Verified tutors are shown to parents first.</span>
        <span className="text-[11px] font-semibold" lang="ur" dir="rtl">
          تصدیق شدہ ٹیوٹرز والدین کو پہلے دکھائے جاتے ہیں
        </span>
      </p>

      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-[11px] font-bold text-tm-red">{error}</p>
          {stuck && <SubmitEscape href={stuck} />}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={!both || starting}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
