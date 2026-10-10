'use client'

import { useEffect, useState } from 'react'

import { DOC_ROTATED_EVENT } from '@/lib/docRotation'

// Renders a watermarked document preview from /api/documents/[id]/preview.
//
// The src is always that route, never a storage URL: the browser is never given
// a path it could use to reach an original.
//
// Right-click, drag and the long-press save sheet are disabled. Per CLAUDE.md
// this protects against casual copying only -- a screenshot still works, and
// the Terms must say "protected against casual copying", never "cannot be
// screenshotted".
//
// ROTATION (owner, 10 Oct 2026). A rotation staff saved on the document is
// applied by the preview route itself, so the picture arrives the right way up
// and `w-full h-auto` gives it its true aspect — no cropping, no overflow. When
// a rotation is saved in the admin viewer, every thumbnail of that document on
// the page fetches its picture again (the event below).

export default function SecureDocumentPreview({
  documentId,
  alt,
  className = '',
}: {
  documentId: string
  alt: string
  className?: string
}) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const onRotated = (e: Event) => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id === documentId) setVersion((v) => v + 1)
    }
    window.addEventListener(DOC_ROTATED_EVENT, onRotated)
    return () => window.removeEventListener(DOC_ROTATED_EVENT, onRotated)
  }, [documentId])

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-gray-200 bg-tm-bg select-none ${className}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/documents/${documentId}/preview${version ? `?r=${version}` : ''}`}
        alt={alt}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-auto pointer-events-none select-none"
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      />
      {/* Transparent cover so the image itself is never the drag/press target. */}
      <div className="absolute inset-0" aria-hidden="true" />
    </div>
  )
}
