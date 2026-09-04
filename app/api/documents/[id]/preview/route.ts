import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DOCS_BUCKET } from '@/lib/documents'

// The ONLY way bytes leave the private identity-docs bucket.
//
// Serves the watermarked derivative and never the original -- no branch in
// this file reads original_path, by design.
//
// Rights, decided HERE and only here:
//   cnic   -> the owner, or an admin. Nobody else, signed in or not.
//   selfie -> same as cnic. Held for verification only, never shown to parents.
//   degree -> the owner, an admin, or any SIGNED-IN user, so a parent can see
//             a tutor's qualifications. Anonymous requests are refused, which
//             keeps certificates away from scrapers.
//
// degree is the ONLY kind widened beyond owner+admin. A kind added later is
// private by default -- the test below names degree, not the private kinds.
//
// The row lookup and the download both use the service-role client. That is
// deliberate: storage RLS on identity-docs is owner+admin only, so a parent
// viewing a tutor's degree could never fetch the bytes with their own client.
// This route is the authority on access; the bucket stays closed to everyone
// else. Rights are therefore checked BEFORE any privileged call is made.
//
// A refusal is always 404, never 403: whether a document exists is itself
// information we do not owe an unauthorised caller.

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deny = () => new NextResponse('Not found', { status: 404 })

  if (!/^[0-9a-f-]{36}$/i.test(id)) return deny()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Anonymous callers get nothing, for either kind.
  if (!user) return deny()

  const admin = createAdminClient()
  if (!admin) {
    return new NextResponse('Preview unavailable', { status: 503 })
  }

  const { data: doc } = await admin
    .from('user_documents')
    .select('id, user_id, kind, preview_path')
    .eq('id', id)
    .maybeSingle()

  if (!doc || !doc.preview_path) return deny()

  const isOwner = doc.user_id === user.id

  if (!isOwner && doc.kind !== 'degree') {
    // Only an admin may see someone else's CNIC or selfie.
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (me?.role !== 'admin') return deny()
  }
  // doc.kind === 'degree' for a non-owner: allowed, because they are signed in.

  const { data: file, error } = await admin.storage.from(DOCS_BUCKET).download(doc.preview_path)
  if (error || !file) return deny()

  return new NextResponse(await file.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      // Private: never let a shared cache hold someone's identity document.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
