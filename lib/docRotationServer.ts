// lib/docRotationServer.ts
//
// Saving a document's display rotation (lib/docRotation). The ONLY write is the
// `rotation` column on the document's own row — no storage call exists in this
// file, by design: the original and the preview stay exactly as uploaded.
// Audited with who, which document, and the old and new rotation.
//
// Not affected by the approved-document lock: that lock stops a MEMBER
// replacing a file; this is a staff display setting and can be changed again
// at any time.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { normaliseRotation, rotateBy, type Rotation } from '@/lib/docRotation'

export type SaveRotationResult =
  | { ok: true; rotation: Rotation; previous: Rotation }
  | { ok: false; status: 400 | 404 | 503; error: string }

/**
 * Turn a document by `delta` (90 / 180 / 270 clockwise) from its saved
 * rotation. A delta rather than an absolute value, because the picture the
 * viewer shows is already turned by the saved rotation — "what staff see, plus
 * the turns they made" is the one thing the browser knows for certain.
 */
export async function saveDocumentRotation(args: {
  actor: AdminActor
  documentId: string
  delta: number
}): Promise<SaveRotationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }

  const { data: doc } = await admin
    .from('user_documents')
    .select('id, user_id, kind, label, rotation')
    .eq('id', args.documentId)
    .maybeSingle()
  if (!doc) return { ok: false, status: 404, error: 'That document was not found. Reload the page and try again.' }

  const previous = normaliseRotation(doc.rotation)
  const rotation = rotateBy(previous, args.delta)
  if (rotation === previous) return { ok: true, rotation, previous }

  const { error } = await admin.from('user_documents').update({ rotation }).eq('id', args.documentId)
  if (error) return { ok: false, status: 400, error: 'The rotation did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'document.rotate',
    targetType: 'user_document',
    targetId: args.documentId,
    detail: { memberId: doc.user_id, kind: doc.kind, label: doc.label ?? null, oldRotation: previous, newRotation: rotation },
  })
  return { ok: true, rotation, previous }
}
