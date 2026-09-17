'use client'

import { Camera, Images, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

// The ONE camera-or-gallery capture tile (PR22 §3).
//
// The bug it fixes: an identity tile used a single `<input capture="environment">`,
// which on a phone FORCES the camera open and hides the gallery — so a tutor who
// already has a clear photo of their CNIC (or degree) saved on their phone had no
// way to use it. Tapping the tile now offers two choices:
//
//   * "Take a photo"      — a `capture=<facingMode>` input, so the camera opens,
//   * "Choose from gallery" — a plain image input, so an existing photo is picked.
//
// Both hand the chosen File to `onPick`; the CALLER compresses it (under 1 MB via
// lib/imageCompress `compressUnder1MB`) and uploads it. This component owns only
// the tile, the two-choice chooser and the two inputs, so the CNIC field, the
// onboarding degree step and the Settings selfie share one behaviour and cannot
// drift apart.

export default function PhotoCaptureTile({
  facingMode = 'environment',
  aspectClass = 'aspect-[1.6]',
  label,
  urdu,
  ariaLabel,
  disabled = false,
  busy = false,
  done = false,
  preview,
  onPick,
}: {
  /** 'environment' for a document/selfie-of-a-card, 'user' for a face selfie. */
  facingMode?: 'environment' | 'user'
  /** The tile's shape, e.g. 'aspect-[1.6]' (a CNIC card) or 'aspect-square'. */
  aspectClass?: string
  label?: string
  urdu?: string
  /** A noun phrase for the accessible name, e.g. "the front of your CNIC" — the
   *  tile prefixes "Add a photo of" / "Retake the photo of" around it. */
  ariaLabel: string
  disabled?: boolean
  busy?: boolean
  /** A photo is already in the tile (a fresh pick or a stored one). */
  done?: boolean
  /** What fills the tile: a local <img>, or a stored preview node; null → icon. */
  preview?: ReactNode
  onPick: (file: File) => void
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  // Close the chooser on Escape or a press outside it — the same contract the
  // account menu uses, so a stray tap never leaves it hanging open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  function choose(ref: React.RefObject<HTMLInputElement | null>) {
    setOpen(false)
    ref.current?.click()
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    // Clear the value so picking the SAME file again still fires onChange.
    e.target.value = ''
    if (f) onPick(f)
  }

  return (
    <div ref={wrap} className="flex flex-1 flex-col items-center gap-1.5">
      <div className="relative w-full">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={done ? `Retake the photo of ${ariaLabel}` : `Add a photo of ${ariaLabel}`}
          className={`relative grid w-full ${aspectClass} place-items-center overflow-hidden rounded-xl border-2 disabled:opacity-60 ${
            done ? 'border-tm-green-deep' : 'border-dashed border-gray-300 bg-white'
          }`}
        >
          {preview ?? <Camera size={22} className="text-gray-500" aria-hidden />}
          {busy && (
            <span className="absolute inset-0 grid place-items-center bg-tm-black/40">
              <Loader2 size={20} className="animate-spin text-white" aria-hidden />
            </span>
          )}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-1/2 top-full z-30 mt-1 w-44 max-w-[80vw] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-2xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(cameraRef)}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 text-xs font-bold text-tm-navy hover:bg-tm-bg"
            >
              <Camera aria-hidden size={15} className="shrink-0 text-gray-500" />
              Take a photo
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(galleryRef)}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 text-xs font-bold text-tm-navy hover:bg-tm-bg"
            >
              <Images aria-hidden size={15} className="shrink-0 text-gray-500" />
              Choose from gallery
            </button>
          </div>
        )}
      </div>

      {label && (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[11px] font-bold text-tm-navy">{label}</span>
          {urdu && (
            <span className="text-[10px] text-gray-500" lang="ur" dir="rtl">
              {urdu}
            </span>
          )}
        </span>
      )}

      {/* "Take a photo" — the camera opens (capture). */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture={facingMode}
        className="sr-only"
        onChange={onChange}
      />
      {/* "Choose from gallery" — a plain picker, no capture. */}
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={onChange} />
    </div>
  )
}
