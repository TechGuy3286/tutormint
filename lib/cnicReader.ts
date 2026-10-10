// lib/cnicReader.ts
//
// The server half of the CNIC reader (rules and flow: lib/cnicReaderCore).
//
// PRIVACY AND COST, in one place:
//   - only the CNIC FRONT image is sent to the Claude API — no name, no id, no
//     other document;
//   - the full number and the image are never logged (log lines carry the
//     document id and the outcome word only);
//   - one uploaded image is read at most once: the outcome is cached on the
//     document row, and a second request returns the cached value;
//   - the result is stored ONLY as cnic_read_* on user_documents. This file has
//     no write to profiles: the confirmed number is saved by a person.

import 'server-only'

import sharp from 'sharp'

import { createAdminClient } from '@/lib/supabase/admin'
import { completeWithImage } from '@/lib/ai/anthropic'
import { DOCS_BUCKET } from '@/lib/documents'
import { formatCnic, isValidCnic, normaliseCnic } from '@/lib/cnic'
import { formatName } from '@/lib/formatName'
import { normaliseRotation } from '@/lib/docRotation'
import {
  CNIC_READ_PROMPT,
  CNIC_READ_STALE_MS,
  CNIC_READ_SYSTEM,
  pickCnicFront,
  readDecision,
  runCnicRead,
  type CnicDocRow,
  type CnicReadResult,
} from '@/lib/cnicReaderCore'

const SEND_MAX_EDGE = 1568
const DOC_COLUMNS = 'id, user_id, kind, label, status, created_at, original_path, rotation, cnic_read_status, cnic_read_number, cnic_read_at'

type DocRow = CnicDocRow & { user_id: string; original_path: string | null; rotation: number | null }

/** The member's CNIC front document row, or null. */
export async function findCnicFront(memberId: string): Promise<DocRow | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('user_documents').select(DOC_COLUMNS).eq('user_id', memberId).eq('kind', 'cnic')
  return pickCnicFront((data ?? []) as DocRow[])
}

/** The suggestion already cached for a member, WITHOUT reading anything. */
export async function cachedSuggestion(memberId: string): Promise<{ documentId: string | null; number: string | null; read: boolean }> {
  const doc = await findCnicFront(memberId)
  if (!doc) return { documentId: null, number: null, read: false }
  const d = readDecision(doc, Date.now())
  return { documentId: doc.id, number: d.kind === 'cached' ? d.number : null, read: d.kind === 'cached' }
}

/**
 * Read the number from one CNIC front document (once per image; cached).
 * Never throws; never logs the number or the image.
 */
export async function readCnicFromDocument(documentId: string): Promise<CnicReadResult> {
  const admin = createAdminClient()
  if (!admin) return { status: 'unavailable' }
  const { data } = await admin.from('user_documents').select(DOC_COLUMNS).eq('id', documentId).maybeSingle()
  const doc = data as DocRow | null
  if (!doc || doc.kind !== 'cnic' || (doc.label ?? 'front') === 'back') return { status: 'unavailable' }

  const staleBefore = new Date(Date.now() - CNIC_READ_STALE_MS).toISOString()
  const result = await runCnicRead({
    doc,
    nowMs: Date.now(),
    claim: async () => {
      // One statement, so two requests cannot both claim: only a row that is
      // unread, or whose claim went stale, is taken.
      const { data: claimed } = await admin
        .from('user_documents')
        .update({ cnic_read_status: 'reading', cnic_read_at: new Date().toISOString() })
        .eq('id', documentId)
        .or(`cnic_read_status.is.null,and(cnic_read_status.eq.reading,cnic_read_at.lt.${staleBefore})`)
        .select('id')
      return (claimed ?? []).length === 1
    },
    release: async () => {
      await admin.from('user_documents').update({ cnic_read_status: null, cnic_read_at: null }).eq('id', documentId).eq('cnic_read_status', 'reading')
    },
    loadImage: async () => {
      if (!doc.original_path) return null
      const { data: file, error } = await admin.storage.from(DOCS_BUCKET).download(doc.original_path)
      if (error || !file) return null
      // In memory only: the right way up (EXIF, then the rotation staff saved),
      // sized for the API. The stored file is not touched.
      const upright = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' }).rotate().toBuffer()
      const turned = normaliseRotation(doc.rotation)
      const out = await sharp(upright)
        .rotate(turned)
        .resize({ width: SEND_MAX_EDGE, height: SEND_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer()
      return { mediaType: 'image/jpeg' as const, base64: out.toString('base64') }
    },
    vision: (image) => completeWithImage({ system: CNIC_READ_SYSTEM, prompt: CNIC_READ_PROMPT, image, maxTokens: 30, timeoutMs: 25_000 }),
    saveSuggestion: async (number) => {
      await admin
        .from('user_documents')
        .update({ cnic_read_status: number ? 'found' : 'none', cnic_read_number: number, cnic_read_at: new Date().toISOString() })
        .eq('id', documentId)
    },
  })
  console.info(`[cnic-read] doc=${documentId} outcome=${result.status}${'cached' in result && result.cached ? ' (cached)' : ''}`)
  return result
}

/** Read for a member: their CNIC front, if they have one. */
export async function readCnicForMember(memberId: string): Promise<CnicReadResult & { documentId?: string }> {
  const doc = await findCnicFront(memberId)
  if (!doc) return { status: 'unavailable' }
  return { ...(await readCnicFromDocument(doc.id)), documentId: doc.id }
}

/**
 * STAFF ONLY: the other account that already holds this CNIC number, if any.
 * A warning, never a block. Nothing here is ever sent to a member.
 */
export async function cnicDuplicateFor(memberId: string, number: string | null | undefined): Promise<{ id: string; name: string } | null> {
  if (!isValidCnic(number)) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('cnic_number', [formatCnic(number), normaliseCnic(number)])
    .neq('id', memberId)
    .limit(1)
  const row = (data ?? [])[0] as { id: string; full_name: string | null } | undefined
  return row ? { id: row.id, name: formatName(row.full_name) || 'Unnamed member' } : null
}
