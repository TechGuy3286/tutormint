'use client'

// Renders a watermarked document preview from /api/documents/[id]/preview.
//
// The src is always that route, never a storage URL: the browser is never given
// a path it could use to reach an original.
//
// Right-click, drag and the long-press save sheet are disabled. Per CLAUDE.md
// this protects against casual copying only -- a screenshot still works, and
// the Terms must say "protected against casual copying", never "cannot be
// screenshotted".

export default function SecureDocumentPreview({
  documentId,
  alt,
  className = '',
}: {
  documentId: string
  alt: string
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-gray-200 bg-[#F8FAFC] select-none ${className}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/documents/${documentId}/preview`}
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
