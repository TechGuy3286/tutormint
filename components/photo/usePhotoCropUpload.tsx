'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'

import PhotoCropper from '@/components/photo/PhotoCropper'
import { compressImage } from '@/lib/imageCompress'
import { cropPixels, type CropRect } from '@/lib/photoCropCore'

// The crop step a member sees after choosing a profile photo (owner, 11 Oct
// 2026) — used by the onboarding photo step, complete-profile, and tutor and
// parent Settings, so they cannot drift:
//
//   const { dialog, cropAndUpload } = usePhotoCropUpload()
//   const url = await cropAndUpload(file)   // null = the member closed it
//   ... save `url` as the profile photo exactly as before ...
//   return <>{dialog} ...</>
//
// The chosen photo is shrunk in the browser (lib/imageCompress), shown in the
// round frame, and on "Use photo" BOTH the photo and the framed square are sent
// to /api/profile/photo. The profile uses the square; staff can see both.
// Canvas only — no library. Rendered through a portal into <body> so no
// transformed card can become its containing block.

const CROP_SIDE = 640

type Open = { file: File; src: string }

const subscribeNoop = () => () => {}

/** The framed square as a JPEG, drawn from the same picture the frame shows. */
async function cutSquare(src: string, rect: CropRect): Promise<Blob | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => resolve(null)
    el.src = src
  })
  if (!img) return null
  const px = cropPixels(rect, img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = CROP_SIDE
  canvas.height = CROP_SIDE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, px.left, px.top, px.side, px.side, 0, 0, CROP_SIDE, CROP_SIDE)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9))
}

export function usePhotoCropUpload(): { dialog: ReactNode; cropAndUpload: (file: File) => Promise<string | null> } {
  const inBrowser = useSyncExternalStore(subscribeNoop, () => true, () => false)
  const [open, setOpen] = useState<Open | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ en: string; ur?: string } | null>(null)
  const rect = useRef<CropRect | null>(null)
  const settle = useRef<((url: string | null) => void) | null>(null)
  const another = useRef<HTMLInputElement>(null)

  const show = useCallback(async (file: File) => {
    // Shrunk first: a raw camera photo is 4–8 MB and would not fit the request.
    const small = await compressImage(file)
    setOpen((old) => {
      if (old) URL.revokeObjectURL(old.src)
      return { file: small, src: URL.createObjectURL(small) }
    })
    rect.current = null
    setError(null)
  }, [])

  const cropAndUpload = useCallback(
    (file: File) =>
      new Promise<string | null>((resolve) => {
        // A second pick while one is open replaces it; the first caller hears "closed".
        settle.current?.(null)
        settle.current = resolve
        void show(file)
      }),
    [show],
  )

  const finish = (url: string | null) => {
    setOpen((old) => {
      if (old) URL.revokeObjectURL(old.src)
      return null
    })
    setBusy(false)
    settle.current?.(url)
    settle.current = null
  }

  const use = async () => {
    if (!open || busy) return
    if (!rect.current) return
    setBusy(true)
    setError(null)
    try {
      const square = await cutSquare(open.src, rect.current)
      if (!square) throw new Error('cut')
      const body = new FormData()
      body.append('original', open.file, 'photo.jpg')
      body.append('crop', square, 'crop.jpg')
      body.append('x', String(rect.current.x))
      body.append('y', String(rect.current.y))
      body.append('s', String(rect.current.s))
      const res = await fetch('/api/profile/photo', { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string; errorUr?: string } | null
      if (!res.ok || !data?.url) {
        setError({ en: data?.error ?? 'The photo did not upload. Please try again.', ur: data?.errorUr ?? 'تصویر اپ لوڈ نہیں ہوئی۔ دوبارہ کوشش کریں۔' })
        setBusy(false)
        return
      }
      finish(data.url)
    } catch {
      setError({ en: 'The photo did not upload. Check your internet connection and try again.', ur: 'تصویر اپ لوڈ نہیں ہوئی۔ انٹرنیٹ چیک کریں اور دوبارہ کوشش کریں۔' })
      setBusy(false)
    }
  }

  // Hold the page still behind the crop step.
  const isOpen = !!open
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  const dialog =
    open && inBrowser
      ? createPortal(
          <div className="fixed inset-0 z-[98] flex h-dvh w-screen items-end justify-center bg-tm-black/70 sm:items-center" role="dialog" aria-modal="true" aria-label="Adjust your photo" data-photo-crop="">
            <div className="max-h-dvh w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:rounded-2xl">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-black text-tm-navy">Adjust your photo</h2>
                <button type="button" aria-label="Close" disabled={busy} onClick={() => finish(null)} className="grid h-11 w-11 place-items-center rounded-lg text-slate-700 hover:bg-tm-bg">
                  <X size={20} aria-hidden />
                </button>
              </div>
              <PhotoCropper
                src={open.src}
                onChange={(c) => {
                  rect.current = c
                }}
                onError={() => setError({ en: 'That file could not be opened as a photo. Please choose another.', ur: 'یہ فائل تصویر کے طور پر نہیں کھل سکی۔ دوسری تصویر چنیں۔' })}
              />
              <div className="text-center">
                <p className="text-sm font-bold text-slate-800">Move and zoom so your face fills the circle</p>
                <p className="text-sm text-slate-700" dir="rtl" lang="ur">
                  تصویر کو ہلائیں اور بڑا کریں تاکہ آپ کا چہرہ دائرے میں پورا آ جائے
                </p>
              </div>
              {error && (
                <div role="alert" className="rounded-xl bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red">
                  <p>{error.en}</p>
                  {error.ur && (
                    <p dir="rtl" lang="ur">
                      {error.ur}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => another.current?.click()}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-60"
                >
                  Choose another
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void use()}
                  className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-3 text-sm font-black text-white hover:bg-tm-navy-hover disabled:opacity-60"
                >
                  {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Use photo
                </button>
              </div>
              <input
                ref={another}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void show(f)
                }}
              />
            </div>
          </div>,
          document.body,
        )
      : null

  return { dialog, cropAndUpload }
}
