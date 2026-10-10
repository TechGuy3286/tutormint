// lib/cnicReaderCore.ts
//
// Reading the 13-digit CNIC number off the photo of a CNIC front (owner,
// 10 Oct 2026). Many tutors upload the photos without typing the number, and
// staff were typing it by hand from the picture before they could approve.
//
// THE READ IS A SUGGESTION, NEVER THE NUMBER. It is cached on the document's
// own row (user_documents.cnic_read_*, migration 160) and pre-fills a box. The
// member's number — profiles.cnic_number — is written only by the existing
// save paths, when a person presses Save, Approve or Next. Nothing in this
// file, or in lib/cnicReader, writes profiles.
//
// This is the pure half: the prompt, the validation of the model's reply, which
// document is "the front", the once-per-image rule, and the flow with its I/O
// injected — so the tests run it with a mocked Claude API.

import { formatCnic } from '@/lib/cnic'

export const CNIC_READ_SYSTEM =
  'You read one field from a photo of a Pakistani national identity card (CNIC). You reply with that field only.'

export const CNIC_READ_PROMPT = [
  'This is a photo of the FRONT of a Pakistani CNIC.',
  'Find the 13-digit Identity Number printed on the card (it is written as 5 digits, 7 digits, 1 digit).',
  'Reply with ONLY that number in the format 12345-1234567-1 and nothing else.',
  'If the number is not visible, is cut off, is blurred, or you are not sure of every digit, reply with exactly: none',
  'Do not guess a digit. Do not add any other words.',
].join('\n')

/**
 * The model's reply → the number in the stored format (42101-1234567-1), or
 * null. STRICT: the whole reply must be the number — 13 digits, optionally with
 * the two dashes or spaces in the 5-7-1 places. "none", a sentence, twelve or
 * fourteen digits, two numbers, anything else: not found.
 */
export function parseCnicReading(reply: string | null | undefined): string | null {
  const text = (reply ?? '').trim()
  if (!text) return null
  if (!/^\d{5}[-\s]?\d{7}[-\s]?\d$/.test(text)) return null
  const formatted = formatCnic(text)
  return /^\d{5}-\d{7}-\d$/.test(formatted) ? formatted : null
}

/** For a console or a log line: only the last 4 digits. XXXXX-XXXX567-1. */
export function maskToLast4(number: string | null | undefined): string | null {
  const d = (number ?? '').replace(/\D/g, '')
  if (d.length !== 13) return null
  return `XXXXX-XXXX${d.slice(9, 12)}-${d.slice(12)}`
}

export type CnicDocRow = {
  id: string
  kind: string
  label: string | null
  status: string | null
  created_at: string
  cnic_read_status?: string | null
  cnic_read_number?: string | null
  cnic_read_at?: string | null
}

/**
 * The member's CNIC FRONT: a cnic document that is not labelled "back", on
 * record ('active') or waiting for review ('review'), newest first. Hidden
 * ('paused') uploads are never read.
 */
export function pickCnicFront<T extends CnicDocRow>(docs: T[]): T | null {
  const fronts = docs
    .filter((d) => d.kind === 'cnic' && (d.label ?? 'front') !== 'back')
    .filter((d) => (d.status ?? 'active') === 'active' || d.status === 'review')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return fronts[0] ?? null
}

/** A read claimed more than this long ago did not finish; it may be retried. */
export const CNIC_READ_STALE_MS = 2 * 60 * 1000

export type ReadDecision =
  | { kind: 'cached'; number: string | null }
  | { kind: 'in_flight' }
  | { kind: 'read' }

/** ONE read per uploaded image: a finished read (found or none) is final. */
export function readDecision(doc: Pick<CnicDocRow, 'cnic_read_status' | 'cnic_read_number' | 'cnic_read_at'>, nowMs: number): ReadDecision {
  if (doc.cnic_read_status === 'found') {
    const n = parseCnicReading(doc.cnic_read_number)
    return { kind: 'cached', number: n }
  }
  if (doc.cnic_read_status === 'none') return { kind: 'cached', number: null }
  if (doc.cnic_read_status === 'reading') {
    const at = doc.cnic_read_at ? Date.parse(doc.cnic_read_at) : NaN
    if (Number.isFinite(at) && nowMs - at < CNIC_READ_STALE_MS) return { kind: 'in_flight' }
  }
  return { kind: 'read' }
}

export type CnicReadResult =
  /** A clear 13-digit read. A suggestion to check against the image. */
  | { status: 'found'; number: string; cached: boolean }
  /** Read, and no clear number. */
  | { status: 'none'; cached: boolean }
  /** Another request is reading this image right now. */
  | { status: 'pending' }
  /** The reader could not run (no key, a timeout, no image). Nothing is cached, so it can be tried again. */
  | { status: 'unavailable' }

export type VisionReply = { ok: true; text: string } | { ok: false; reason: string }

/**
 * The read, with every side effect injected. The ONLY writes it can make are
 * `claim`, `release` and `saveSuggestion`, all on the document's own row.
 */
export async function runCnicRead(deps: {
  doc: Pick<CnicDocRow, 'cnic_read_status' | 'cnic_read_number' | 'cnic_read_at'>
  nowMs: number
  /** Mark the document 'reading'. False when another request got there first. */
  claim: () => Promise<boolean>
  /** Clear a claim after a failed read, so it can be retried. */
  release: () => Promise<void>
  /** The CNIC front image, ready to send. Null when it cannot be loaded. */
  loadImage: () => Promise<{ mediaType: 'image/jpeg'; base64: string } | null>
  vision: (image: { mediaType: 'image/jpeg'; base64: string }) => Promise<VisionReply>
  /** Cache the outcome on the document: the suggested number, or none. */
  saveSuggestion: (number: string | null) => Promise<void>
}): Promise<CnicReadResult> {
  const decision = readDecision(deps.doc, deps.nowMs)
  if (decision.kind === 'cached') {
    return decision.number ? { status: 'found', number: decision.number, cached: true } : { status: 'none', cached: true }
  }
  if (decision.kind === 'in_flight') return { status: 'pending' }
  if (!(await deps.claim())) return { status: 'pending' }

  try {
    const image = await deps.loadImage()
    if (!image) {
      await deps.release()
      return { status: 'unavailable' }
    }
    const reply = await deps.vision(image)
    if (!reply.ok) {
      await deps.release()
      return { status: 'unavailable' }
    }
    const number = parseCnicReading(reply.text)
    await deps.saveSuggestion(number)
    return number ? { status: 'found', number, cached: false } : { status: 'none', cached: false }
  } catch {
    await deps.release().catch(() => {})
    return { status: 'unavailable' }
  }
}

// What each side is told.
export const CNIC_SUGGESTED_STAFF = 'Suggested from photo — check it against the image before approving.'
export const CNIC_NOT_READ_STAFF = 'Couldn’t read the number clearly. Please type it.'
export const CNIC_SUGGESTED_MEMBER = 'We read this number from your CNIC photo. Check it matches your card before you continue.'
export const CNIC_SUGGESTED_MEMBER_UR = 'یہ نمبر آپ کے شناختی کارڈ کی تصویر سے پڑھا گیا ہے۔ آگے بڑھنے سے پہلے دیکھ لیں کہ یہ آپ کے کارڈ سے ملتا ہے۔'
export const CNIC_DUPLICATE_STAFF = 'This CNIC number is already on another account'
