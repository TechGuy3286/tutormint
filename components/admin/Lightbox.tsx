'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react'

// Admin image viewer (PR106-C §3). Opens any admin image larger: fit-to-screen,
// zoom in/out, next/previous between related images, close by tap outside, X or
// Esc. Works on phone and desktop. Controlled: the parent holds the open set and
// index. Admin-only chrome — not a public component.

export type LightboxImage = { src: string; alt: string }

export default function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[]
  /** The open image, or null when closed. */
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const open = index !== null && index >= 0 && index < images.length
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const go = useCallback(
    (delta: number) => {
      if (index === null) return
      const n = images.length
      onIndex((index + delta + n) % n)
      reset()
    },
    [index, images.length, onIndex, reset],
  )

  // Reset the zoom/pan whenever the shown image changes.
  useEffect(() => { reset() }, [index, reset])

  // Keyboard: Esc closes, arrows page, +/- zoom.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.5))
      else if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5))
    }
    document.addEventListener('keydown', onKey)
    // Lock body scroll while open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, go, onClose])

  if (!open) return null
  const img = images[index as number]
  const many = images.length > 1

  const startDrag = (x: number, y: number) => {
    if (zoom <= 1) return
    drag.current = { x, y, px: pan.x, py: pan.y }
  }
  const moveDrag = (x: number, y: number) => {
    if (!drag.current) return
    setPan({ x: drag.current.px + (x - drag.current.x), y: drag.current.py + (y - drag.current.y) })
  }
  const endDrag = () => { drag.current = null }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-tm-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      // Tap outside the image closes.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      onTouchStart={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Top bar: label + controls. */}
      <div className="flex items-center justify-between gap-2 p-3 text-white">
        <span className="min-w-0 truncate text-xs font-bold">
          {img.alt}
          {many ? ` · ${(index as number) + 1} of ${images.length}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"><ZoomOut size={20} /></button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
            className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"><ZoomIn size={20} /></button>
          <button type="button" aria-label="Close" onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10"><X size={22} /></button>
        </div>
      </div>

      {/* Image area — object-contain fits to screen; zoom/pan on top. */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden p-2"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); else startDrag(e.clientX, e.clientY) }}
        onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={(e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY) }}
        onTouchMove={(e) => { const t = e.touches[0]; moveDrag(t.clientX, t.clientY) }}
        onTouchEnd={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={img.alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? 'grab' : 'default',
            transition: drag.current ? 'none' : 'transform 0.12s ease-out',
          }}
        />

        {many && (
          <>
            <button type="button" aria-label="Previous image" onClick={() => go(-1)}
              className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-tm-black/60 text-white hover:bg-tm-black/80">
              <ChevronLeft size={26} />
            </button>
            <button type="button" aria-label="Next image" onClick={() => go(1)}
              className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-tm-black/60 text-white hover:bg-tm-black/80">
              <ChevronRight size={26} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
