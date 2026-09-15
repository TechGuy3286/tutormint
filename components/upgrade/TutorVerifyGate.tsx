'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, Loader2 } from 'lucide-react'

import type { Gate } from '@/lib/gate'
import { compressImage } from '@/lib/imageCompress'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'

// The Rs 199 one-time verification gate an UNVERIFIED tutor meets when they tap
// Apply (owner, Part 4, 15 Sep 2026). It replaces the old plain upgrade popup:
//
//   * bilingual heading + body (supplied by lib/gate.ts, consistent with
//     onboarding),
//   * CNIC FRONT and BACK uploaded inline — two separate camera opens
//     (capture=environment), each showing a small preview thumbnail once taken so
//     he can retake,
//   * the images save to his profile automatically (POST /api/documents/upload,
//     kind 'cnic' — the private identity-docs bucket; never re-uploaded elsewhere,
//     never shown publicly),
//   * one primary "Verify" button that starts checkout for the one-time fee.
//
// The ONLY outcome language allowed is the exact encouraging line "Verified
// tutors are shown to parents first." — no promise of being hired.

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
        {done && !busy && (
          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-tm-green-deep">
            <Check size={12} className="text-white" aria-hidden />
          </span>
        )}
      </button>
      <span className="flex flex-col items-center leading-tight">
        <span className="text-[11px] font-bold text-tm-navy">
          {done ? 'Tap to retake' : label}
        </span>
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

export default function TutorVerifyGate({ gate, onClose }: { gate: Gate; onClose: () => void }) {
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

  // gate.body is bilingual, English then Urdu, separated by a blank line.
  const paras = gate.body.split('\n\n').filter((p) => p.trim().length > 0)

  return (
    <div className="mt-3 space-y-4">
      {paras.map((p, i) => (
        <p
          key={i}
          className="text-xs leading-relaxed text-slate-700"
          {...(i > 0 ? { lang: 'ur', dir: 'rtl' as const } : {})}
        >
          {p}
        </p>
      ))}

      {/* CNIC front + back. Two camera opens; a thumbnail once taken so he can
          retake. Saved privately to his profile automatically. */}
      <div>
        <p className="mb-2 flex flex-col leading-tight">
          <span className="text-xs font-black text-tm-navy">Upload your CNIC</span>
          <span className="text-[10px] text-gray-500" lang="ur" dir="rtl">
            اپنا شناختی کارڈ اپلوڈ کریں
          </span>
        </p>
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
        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
          Your CNIC is private — only our verification team can see it. It never appears on your
          public profile.
        </p>
      </div>

      {gate.plan && (
        <div className="rounded-2xl border border-tm-navy/15 bg-tm-tint-navy p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-black text-tm-navy">Verification fee</p>
            <p className="text-sm font-black text-tm-red">
              Rs {gate.plan.pricePkr.toLocaleString('en-PK')}
              <span className="text-[11px] font-bold text-slate-700"> · one-time</span>
            </p>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-tm-navy">
            Paid once. No renewal, no monthly charge. Non-refundable.
          </p>
        </div>
      )}

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
      {!both && (
        <p className="text-center text-[10px] text-gray-500">
          Add both sides of your CNIC to continue.
        </p>
      )}
    </div>
  )
}
