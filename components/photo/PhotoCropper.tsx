'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { MAX_ZOOM, clampOffset, coverScale, cropFromView, initialOffset, zoomAtCentre, type CropRect } from '@/lib/photoCropCore'

// The round crop frame (owner, 11 Oct 2026) — ONE implementation for the admin
// viewer's "Crop / adjust" and the member's crop step at upload. Drag to move;
// pinch, or the slider, to zoom. It starts face-first (centred, a little down
// from the top). All the arithmetic is in lib/photoCropCore; this file only
// turns fingers into numbers and reports the crop as fractions of the picture.
//
// No library: mouse and touch events and a range input, which is everything an
// older Android Chrome has. The frame takes the gesture itself (touch-none) so
// the page neither scrolls nor zooms under a pinch.

export default function PhotoCropper({
  src,
  onChange,
  dark = false,
  onError,
}: {
  src: string
  /** Called whenever the framing changes, and once when the picture loads. */
  onChange: (crop: CropRect) => void
  /** White slider text on the dark admin viewer. */
  dark?: boolean
  onError?: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [frame, setFrame] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ ox: 0, oy: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // The frame's drawn size, read when it is laid out and when the window changes.
  useEffect(() => {
    const read = () => setFrame(frameRef.current?.clientWidth ?? 0)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  const base = nat && frame ? coverScale(nat.w, nat.h, frame) : 0
  const scale = base * zoom

  // A new picture, or a new frame size, starts face-first at zoom 1.
  const [startedFor, setStartedFor] = useState('')
  const startKey = nat && frame ? `${src}|${nat.w}x${nat.h}|${frame}` : ''
  if (startKey && startKey !== startedFor) {
    setStartedFor(startKey)
    setZoom(1)
    setPos(initialOffset(nat!.w, nat!.h, frame, base))
  }

  useEffect(() => {
    if (!nat || !frame || !scale) return
    onChangeRef.current(cropFromView({ w: nat.w, h: nat.h, frame, scale, ox: pos.ox, oy: pos.oy }))
  }, [nat, frame, scale, pos])

  const move = useCallback(
    (ox: number, oy: number) => {
      if (!nat || !frame || !scale) return
      setPos(clampOffset({ w: nat.w, h: nat.h, frame, scale, ox, oy }))
    },
    [nat, frame, scale],
  )
  const zoomTo = (next: number) => {
    if (!nat || !frame || !base) return
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    setPos(zoomAtCentre({ w: nat.w, h: nat.h, frame, scale, ox: pos.ox, oy: pos.oy }, base * z))
    setZoom(z)
  }

  const start = (x: number, y: number) => {
    drag.current = { x, y, ox: pos.ox, oy: pos.oy }
  }
  const drive = (x: number, y: number) => {
    const d = drag.current
    if (d) move(d.ox + (x - d.x), d.oy + (y - d.y))
  }
  const end = () => {
    drag.current = null
    pinch.current = null
  }
  const spread = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        ref={frameRef}
        data-crop-frame=""
        className="relative aspect-square w-[min(78vw,320px)] touch-none select-none overflow-hidden rounded-2xl bg-tm-black"
        style={{ cursor: 'grab' }}
        onMouseDown={(e) => {
          e.preventDefault()
          start(e.clientX, e.clientY)
        }}
        onMouseMove={(e) => drive(e.clientX, e.clientY)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            drag.current = null
            pinch.current = { dist: spread(e.touches), zoom }
          } else if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY)
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current && pinch.current.dist > 0) zoomTo(pinch.current.zoom * (spread(e.touches) / pinch.current.dist))
          else if (e.touches.length === 1) drive(e.touches[0].clientX, e.touches[0].clientY)
        }}
        onTouchEnd={end}
        onTouchCancel={end}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local or private picture being framed: never through the optimiser */}
        <img
          src={src}
          alt="Photo being cropped"
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={onError}
          className="pointer-events-none absolute left-0 top-0 max-w-none"
          style={
            nat && scale
              ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(${pos.ox}px, ${pos.oy}px)` }
              : { width: '100%', height: '100%', objectFit: 'cover', opacity: 0 }
          }
        />
        {/* The round window: everything outside the circle is dimmed. */}
        {/* A ring 1000px thick whose inner edge is the circle (no colour maths, so
            it draws the same on an old Android Chrome). */}
        <div aria-hidden className="pointer-events-none absolute -inset-[1000px] rounded-full border-[1000px] border-tm-black/60" />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-white" />
      </div>
      <label className={`flex w-[min(78vw,320px)] items-center gap-2 text-xs font-bold ${dark ? 'text-white' : 'text-slate-700'}`}>
        Zoom
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => zoomTo(Number(e.target.value))}
          className="h-11 min-w-0 flex-1 accent-tm-red"
          aria-label="Zoom"
        />
      </label>
    </div>
  )
}
