'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Save, Loader2, Maximize2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { DOC_ROTATED_EVENT, rotateBy, swapsAspect } from '@/lib/docRotation'

// THE admin document viewer — the one full-size view for every document image
// in admin (CNIC front/back, selfie, profile picture, degree certificates): the
// tutor and parent review cards, the Verification queues, the member page.
//
// WHY IT USED TO SHAKE (owner, 10 Oct 2026). The old viewer was `position:
// fixed` but rendered INSIDE the review card, and every card on the site lifts
// on hover with `transform: translateY(-2px)` (app/globals.css). A transformed
// ancestor becomes the containing block of a fixed descendant — so while the
// pointer was over the card the "full-screen" overlay was laid out against the
// CARD, the pointer was then no longer over it, the transform came off, the
// overlay jumped back to the screen, and round it went. The fix is at the root:
// the viewer is rendered through a PORTAL into <body>, where no ancestor can
// transform it. Three smaller sources of jitter went with it:
//   - the picture is sized from the viewport (vw / dvh), never from a measured
//     box, so there is no resize loop and nothing moves when it loads;
//   - no CSS transition on the picture's transform (zoom and drag follow the
//     finger exactly), and the stage takes the gesture (`touch-action: none`) so
//     the browser does not also scroll or zoom the page under a pinch;
//   - closing is a `click`, not a touchstart — a touchstart close let the
//     follow-up click land on the thumbnail underneath and reopen it; and the
//     scrollbar's width is held while the page scroll is locked.
//
// ROTATE. "Rotate left ⟲" / "Rotate right ⟳" turn the picture on screen; "Save
// rotation" stores the turn on the document's row (lib/docRotation). The stored
// file is never changed. Offered only for a stored document (not the profile
// picture, which has no document record) and never to a view-only Partner.

export type ViewerImage = {
  src: string
  alt: string
  /** The user_documents id, when the image is a stored document (rotatable). */
  documentId?: string
}

const subscribeNoop = () => () => {}

export default function DocumentViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: ViewerImage[]
  /** The open image, or null when closed. */
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const open = index !== null && index >= 0 && index < images.length
  // True in the browser, false while server-rendering: a portal needs <body>.
  const inBrowser = useSyncExternalStore(subscribeNoop, () => true, () => false)
  const readOnly = useAdminReadOnly()
  const toast = useToast()

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  /** Turns made in the viewer and not saved yet (clockwise, from the picture as served). */
  const [turns, setTurns] = useState(0)
  const [saving, setSaving] = useState(false)
  /** Per document: bumped after a save so the picture is fetched again. */
  const [versions, setVersions] = useState<Record<string, number>>({})

  // The parent passes fresh callbacks on every render; refs keep the keyboard
  // effect below tied to `open` alone, so it does not re-run (and re-lock the
  // page) each time the parent renders.
  const onCloseRef = useRef(onClose)
  const onIndexRef = useRef(onIndex)
  const stateRef = useRef({ index, count: images.length })
  useEffect(() => {
    onCloseRef.current = onClose
    onIndexRef.current = onIndex
    stateRef.current = { index, count: images.length }
  })

  // A new picture starts unzoomed, centred and unturned.
  const [shown, setShown] = useState(index)
  if (shown !== index) {
    setShown(index)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setTurns(0)
  }

  const go = (delta: number) => {
    const { index: i, count } = stateRef.current
    if (i === null || count < 2) return
    onIndexRef.current((i + delta + count) % count)
  }
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      else if (e.key === 'ArrowRight') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.5))
      else if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5))
    }
    document.addEventListener('keydown', onKey)
    // Lock the page behind, keeping the scrollbar's width so nothing shifts.
    const { body, documentElement } = document
    const prevOverflow = body.style.overflow
    const prevPadding = body.style.paddingRight
    const gap = window.innerWidth - documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPadding
    }
  }, [open])

  if (!open || !inBrowser) return null
  const img = images[index as number]
  const canRotate = !!img.documentId && !readOnly

  const saveRotation = async () => {
    if (!img.documentId || turns === 0 || saving) return
    setSaving(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/documents/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: img.documentId, delta: turns }),
    })
    setSaving(false)
    if (!ok) {
      toast.error(data?.error ?? 'The rotation did not save. Please try again.')
      return
    }
    const id = img.documentId
    setVersions((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }))
    setTurns(0)
    window.dispatchEvent(new CustomEvent(DOC_ROTATED_EVENT, { detail: { id } }))
    toast.success('Rotation saved. The original file is unchanged.')
  }

  const version = img.documentId ? versions[img.documentId] : undefined
  return createPortal(
    <ViewerFrame
      image={{ ...img, src: version ? `${img.src}?r=${version}` : img.src }}
      position={images.length > 1 ? { at: (index as number) + 1, of: images.length } : null}
      zoom={zoom}
      pan={pan}
      turns={turns}
      canRotate={canRotate}
      saving={saving}
      onZoom={setZoom}
      onPan={setPan}
      onTurn={(delta) => setTurns((t) => rotateBy(t, delta))}
      onSave={() => void saveRotation()}
      onStep={go}
      onClose={onClose}
    />,
    document.body,
  )
}

const BAR_BTN = 'grid h-11 w-11 place-items-center rounded-lg text-white hover:bg-white/10'
const TOOL_BTN =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/30 px-3 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-40'

/** Room kept for the top bar and (when shown) the rotate bar, in px. */
const CHROME_PX = { plain: 84, tools: 148 }

/**
 * The viewer's markup, with no effects and no measuring — exported so the
 * render test can draw it. Everything is sized from the viewport.
 */
export function ViewerFrame({
  image,
  position,
  zoom,
  pan,
  turns,
  canRotate,
  saving,
  onZoom,
  onPan,
  onTurn,
  onSave,
  onStep,
  onClose,
}: {
  image: ViewerImage
  position: { at: number; of: number } | null
  zoom: number
  pan: { x: number; y: number }
  turns: number
  canRotate: boolean
  saving: boolean
  onZoom: (next: number | ((z: number) => number)) => void
  onPan: (p: { x: number; y: number }) => void
  onTurn: (delta: number) => void
  onSave: () => void
  onStep: (delta: number) => void
  onClose: () => void
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  /** A drag or pinch just ended: the click that follows must not close. */
  const moved = useRef(false)

  const clampZoom = (z: number) => Math.min(4, Math.max(1, z))
  const startDrag = (x: number, y: number) => {
    moved.current = false
    if (zoom <= 1) return
    drag.current = { x, y, px: pan.x, py: pan.y }
  }
  const moveDrag = (x: number, y: number) => {
    if (!drag.current) return
    moved.current = true
    onPan({ x: drag.current.px + (x - drag.current.x), y: drag.current.py + (y - drag.current.y) })
  }
  const endDrag = () => {
    drag.current = null
    pinch.current = null
  }
  const spread = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const closeIfOutside = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    if (moved.current) {
      moved.current = false
      return
    }
    onClose()
  }

  // The picture fits the screen from the viewport alone. A quarter turn swaps
  // which viewport side limits which side of the picture.
  const chrome = canRotate ? CHROME_PX.tools : CHROME_PX.plain
  const wide = 'calc(100vw - 16px)'
  const tall = `calc(100dvh - ${chrome}px)`
  const quarter = swapsAspect(turns)

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-tm-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer"
      data-document-viewer=""
      onClick={closeIfOutside}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 p-3 text-white">
        <span className="min-w-0 truncate text-xs font-bold">
          {image.alt}
          {position ? ` · ${position.at} of ${position.of}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => onZoom((z) => clampZoom(z - 0.5))} className={BAR_BTN}>
            <ZoomOut size={20} />
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => onZoom((z) => clampZoom(z + 0.5))} className={BAR_BTN}>
            <ZoomIn size={20} />
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className={BAR_BTN}>
            <X size={22} />
          </button>
        </div>
      </div>

      {/* The stage takes the gesture itself (touch-none): one finger drags a
          zoomed picture, two fingers pinch-zoom it, and the page underneath
          neither scrolls nor zooms. */}
      <div
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-2"
        onClick={closeIfOutside}
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            moved.current = true
            drag.current = null
            pinch.current = { dist: spread(e.touches), zoom }
          } else if (e.touches.length === 1) {
            startDrag(e.touches[0].clientX, e.touches[0].clientY)
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current && pinch.current.dist > 0) {
            moved.current = true
            onZoom(clampZoom(pinch.current.zoom * (spread(e.touches) / pinch.current.dist)))
          } else if (e.touches.length === 1) {
            moveDrag(e.touches[0].clientX, e.touches[0].clientY)
          }
        }}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, watermarked preview: never through the optimiser */}
        <img
          src={image.src}
          alt={image.alt}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className="select-none object-contain"
          style={{
            maxWidth: quarter ? tall : wide,
            maxHeight: quarter ? wide : tall,
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${turns}deg) scale(${zoom})`,
            cursor: zoom > 1 ? 'grab' : 'default',
            WebkitTouchCallout: 'none',
          }}
        />

        {position && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onStep(-1)}
              className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-tm-black/60 text-white hover:bg-tm-black/80"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => onStep(1)}
              className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-tm-black/60 text-white hover:bg-tm-black/80"
            >
              <ChevronRight size={26} />
            </button>
          </>
        )}
      </div>

      {canRotate && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 p-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => onTurn(270)} className={TOOL_BTN}>
            <RotateCcw size={16} aria-hidden /> Rotate left ⟲
          </button>
          <button type="button" onClick={() => onTurn(90)} className={TOOL_BTN}>
            <RotateCw size={16} aria-hidden /> Rotate right ⟳
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={turns === 0 || saving}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-tm-navy disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} Save rotation
          </button>
        </div>
      )}
    </div>
  )
}

/** A thumbnail that opens the viewer on tap or click, with a small expand hint. */
export function ViewerThumb({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open larger"
      className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl"
    >
      {children}
      <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-tm-black/55 text-white opacity-80 group-hover:opacity-100">
        <Maximize2 size={14} aria-hidden />
      </span>
    </button>
  )
}
