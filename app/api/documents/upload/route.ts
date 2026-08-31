import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { storeDocument } from '@/lib/documents'
import { recomputeCompletion } from '@/lib/completion'

// Upload a CNIC scan or a degree certificate.
//
// The original and a watermarked derivative both land in the private
// identity-docs bucket. The response carries only the document id -- storage
// paths are never returned to the browser, so there is nothing for a client to
// turn into a direct URL.
//
// For a CNIC, profiles.cnic_image_path is also set, because the completion
// checklist and the T3.5 admin queue both read it.

export const runtime = 'nodejs' // sharp needs the Node runtime, not edge

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const kind = form.get('kind')
  const file = form.get('file')
  const label = form.get('label')

  if (kind !== 'cnic' && kind !== 'degree') {
    return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  }

  const result = await storeDocument(
    supabase,
    user.id,
    kind,
    file,
    typeof label === 'string' ? label : undefined,
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (kind === 'cnic') {
    await supabase
      .from('profiles')
      .update({ cnic_image_path: result.doc.originalPath })
      .eq('id', user.id)
  }

  const completion = await recomputeCompletion(user.id)

  // Only the id and the route that serves the watermarked preview.
  return NextResponse.json({
    success: true,
    documentId: result.doc.id,
    previewUrl: `/api/documents/${result.doc.id}/preview`,
    completion: completion?.percent ?? null,
  })
}
