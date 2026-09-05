import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { buildGate } from '@/lib/gate'
import { logActivity } from '@/lib/activityLog'
import { buildCvRaw } from '@/lib/cv/build'
import { toCvModel, isCvTemplate, type CvTemplate } from '@/lib/cv/model'
import { canDownloadCv } from '@/lib/cv/access'
import { cvQrDataUri, fetchImageDataUri } from '@/lib/cv/assets'
import { renderCvPdf } from '@/lib/cv/pdf'

// The gated CV download. Every tutor may PREVIEW their CV (the page); this is
// the one action reserved for Verified and above. The gate is enforced HERE,
// not only by the dashboard button — a free tutor gets the gate response, a
// Verified+ tutor gets application/pdf.
//
// react-pdf runs in the Node runtime, and a full-profile render must finish
// well inside the function timeout.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const ent = await getEntitlements(user.id)
  if (ent.audience !== 'tutor') {
    return NextResponse.json({ error: 'Only tutors have a CV.' }, { status: 403 })
  }

  // Server-side gate. A free tutor is refused with the upgrade gate, the same
  // one the dashboard button and the preview page use.
  if (!canDownloadCv(ent)) {
    return NextResponse.json({ gate: await buildGate('cv_download', ent) }, { status: 403 })
  }

  const url = new URL(request.url)
  const template: CvTemplate = isCvTemplate(url.searchParams.get('template'))
    ? (url.searchParams.get('template') as CvTemplate)
    : 'classic'
  const includeContact = url.searchParams.get('contact') !== '0'

  const raw = await buildCvRaw(user.id)
  const model = toCvModel(raw, { includeContact })

  const [qrDataUri, photoDataUri] = await Promise.all([
    cvQrDataUri(model.profileUrl),
    // model.photoUrl is already validated to our avatar buckets; fetch it into
    // the PDF's bytes so the render never depends on a live image request.
    fetchImageDataUri(model.photoUrl),
  ])

  const pdf = await renderCvPdf({ model, template, qrDataUri, photoDataUri })

  await logActivity({ userId: user.id, event: 'cv_downloaded', meta: { template } })

  const safeName = model.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Tutor'
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}-Tutor-CV-TutorMint.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
