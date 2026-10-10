'use client'

import { useState } from 'react'

import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import DocumentViewer, { ViewerThumb } from '@/components/admin/DocumentViewer'

// One admin thumbnail that opens the shared document viewer on its own — for
// server-rendered admin tables (the tutor's field history) that show a single
// picture per cell. A stored document is given by id (rotatable in the viewer);
// a profile picture by URL.

export default function DocumentThumb({
  documentId,
  src,
  alt,
  className = '',
}: {
  documentId?: string
  src?: string
  alt: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const image = documentId ? { src: `/api/documents/${documentId}/preview`, alt, documentId } : src ? { src, alt } : null
  if (!image) return null
  return (
    <div className={className}>
      <ViewerThumb onOpen={() => setOpen(true)}>
        {documentId ? (
          <SecureDocumentPreview documentId={documentId} alt={alt} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only review thumbnail
          <img src={src} alt={alt} className="w-full rounded-xl border border-gray-200 object-cover" />
        )}
      </ViewerThumb>
      <DocumentViewer images={[image]} index={open ? 0 : null} onIndex={() => {}} onClose={() => setOpen(false)} />
    </div>
  )
}
