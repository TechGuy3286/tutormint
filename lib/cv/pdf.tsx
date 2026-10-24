import 'server-only'

import * as ReactPdf from '@react-pdf/renderer'

import { buildCvDocument, type CvDocArgs } from '@/lib/cv/pdfDocument'

// The CV PDF — pure JS via @react-pdf/renderer, no headless browser, no
// external service. The document itself is lib/cv/pdfDocument.tsx (all three
// templates); this file hands it the real react-pdf module and renders it.

export async function renderCvPdf(args: CvDocArgs): Promise<Buffer> {
  return ReactPdf.renderToBuffer(buildCvDocument(ReactPdf, args))
}
