'use client'

// The ONE selfie capture (owner, 21 Oct 2026): camera only — no gallery and no
// file upload. Used by the onboarding selfie step (both flows) and Settings
// (also after an Owner unlock). Rules: lib/liveSelfieCore.
//
//   phone     → "Open camera" opens the FRONT camera directly (capture="user");
//               a file older than a few minutes is refused (a browser that shows
//               a chooser instead of the camera cannot slip an old photo in).
//   computer  → a live webcam preview with "Take photo", then "Retake" /
//               "Use this photo".
//   no camera → "Please open this step on your phone to take your selfie", the
//   / denied    page link and a QR code. No upload fallback.
//
// The caller receives a File and uploads it exactly as before.

import { Camera, Check, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  OLD_PHOTO_MESSAGE,
  SELFIE_HELPER,
  SELFIE_NO_CAMERA,
  isFreshPhoto,
  isPhoneDevice,
  selfieMode,
  type SelfieMode,
} from '@/lib/liveSelfieCore'

const BTN = 'inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-sm font-bold disabled:opacity-50'

export default function LiveSelfieCapture({ busy = false, done = false, preview, onCapture }: {
  busy?: boolean
  /** A selfie is already on file (or was just taken). */
  done?: boolean
  /** The current selfie, shown in the tile; null → a camera icon. */
  preview?: ReactNode
  onCapture: (file: File) => void
}) {
  const [mode, setMode] = useState<SelfieMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    setMode(selfieMode({ phone: isPhoneDevice(navigator.userAgent, coarse), mediaDevices: !!navigator.mediaDevices?.getUserMedia }))
  }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.currentTarget.value = ''
    if (!f) return
    if (!isFreshPhoto(f.lastModified)) { setError(OLD_PHOTO_MESSAGE); return }
    setError(null)
    onCapture(f)
  }

  return (
    <div className="space-y-2.5">
      <p className="text-center text-xs font-semibold text-gray-600">{SELFIE_HELPER}</p>
      {mode === 'webcam' ? (
        <WebcamCapture busy={busy} done={done} preview={preview} onCapture={onCapture} onUnavailable={() => setMode('no_camera')} />
      ) : mode === 'no_camera' ? (
        <NoCamera />
      ) : (
        <>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || !mode} aria-label="Take a selfie with your front camera"
            className="relative mx-auto block aspect-square w-40 overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-tm-bg">
            {preview ?? (
              <span className="grid h-full w-full place-items-center text-gray-500">
                {busy ? <Loader2 size={28} className="animate-spin" aria-hidden /> : done ? <Check size={28} aria-hidden /> : <Camera size={28} aria-hidden />}
              </span>
            )}
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || !mode} className={`${BTN} bg-tm-navy text-white hover:bg-tm-navy-hover`}>
            <Camera size={16} aria-hidden /> {done ? 'Retake selfie' : 'Open camera'}
          </button>
          {/* Camera only: capture="user" opens the front camera; there is no gallery input. */}
          <input ref={inputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} />
        </>
      )}
      {error && <p role="alert" className="text-center text-[11px] font-bold text-tm-red">{error}</p>}
    </div>
  )
}

function WebcamCapture({ busy, done, preview, onCapture, onUnavailable }: {
  busy: boolean; done: boolean; preview?: ReactNode; onCapture: (f: File) => void; onUnavailable: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [live, setLive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setLive(false)
  }
  useEffect(() => () => stop(), [])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const start = async () => {
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      streamRef.current = stream
      setShot(null)
      setLive(true)
      requestAnimationFrame(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => {}) }
      })
    } catch {
      // No camera, or permission denied: no upload fallback.
      onUnavailable()
    } finally {
      setStarting(false)
    }
  }

  const take = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    c.toBlob((b) => {
      if (!b) return
      setShot({ blob: b, url: URL.createObjectURL(b) })
      stop()
    }, 'image/jpeg', 0.9)
  }

  const use = () => {
    if (!shot) return
    onCapture(new File([shot.blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }))
    setShot(null)
  }

  return (
    <div className="space-y-2.5">
      <div className="relative mx-auto aspect-square w-56 overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-tm-bg">
        {live ? (
          // The preview is mirrored like a mirror; the photo itself is not.
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        ) : shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local capture
          <img src={shot.url} alt="Your selfie" className="h-full w-full object-cover" />
        ) : (
          preview ?? (
            <span className="grid h-full w-full place-items-center text-gray-500">
              {busy || starting ? <Loader2 size={28} className="animate-spin" aria-hidden /> : done ? <Check size={28} aria-hidden /> : <Camera size={28} aria-hidden />}
            </span>
          )
        )}
      </div>
      {live ? (
        <button type="button" onClick={take} className={`${BTN} bg-tm-red text-white hover:bg-tm-red-hover`}>
          <Camera size={16} aria-hidden /> Take photo
        </button>
      ) : shot ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void start()} disabled={busy} className={`${BTN} border border-gray-300 bg-white text-tm-navy hover:bg-tm-tint-navy`}>
            <RotateCcw size={16} aria-hidden /> Retake
          </button>
          <button type="button" onClick={use} disabled={busy} className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}>
            <Check size={16} aria-hidden /> Use this photo
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => void start()} disabled={busy || starting} className={`${BTN} bg-tm-navy text-white hover:bg-tm-navy-hover`}>
          <Camera size={16} aria-hidden /> {done ? 'Retake selfie' : 'Open camera'}
        </button>
      )}
    </div>
  )
}

function NoCamera() {
  const [href, setHref] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    const url = window.location.href
    setHref(url)
    void import('qrcode')
      .then((m) => ((m as unknown as { default?: typeof m }).default ?? m).toDataURL(url, { margin: 1, width: 200 }))
      .then(setQr)
      .catch(() => {})
  }, [])
  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-center" role="status">
      <p className="text-sm font-bold text-tm-navy">{SELFIE_NO_CAMERA}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated QR code */}
      {qr && <img src={qr} alt="QR code for this page" width={160} height={160} className="mx-auto h-40 w-40" />}
      {href && <a href={href} className="block break-all text-xs font-semibold text-tm-red underline-offset-2 hover:underline">{href}</a>}
    </div>
  )
}
