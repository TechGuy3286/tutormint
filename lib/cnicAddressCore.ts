// lib/cnicAddressCore.ts — PURE (owner, 18 Nov 2026 — PR-07).
//
// The home address read from the BACK of a member's CNIC, as a SUGGESTION.
// Tutors and parents. The member sees it pre-filled under Home address with
// "We read this from your CNIC. Is this your current address?" and Confirm /
// Edit; only Confirm or Edit writes profiles.address. An address the member
// already entered is never touched — no suggestion is made for them.
//
// Staff see it masked, labelled "Read from CNIC — not confirmed" or
// "Confirmed by member"; the full address comes only through the logged Show
// (address.reveal), for the same reviewers as the CNIC number. Never public.
//
// A read that fails or looks wrong (empty, no known city, mostly symbols)
// saves nothing. No address is ever logged.
//
// This is the pure half: the prompt, the validation of the model's reply, the
// save decision, the labels and the read flow with its I/O injected.
// Unit-tested by scripts/test-cnic-address.ts.

export const ADDRESS_READ_SYSTEM =
  'You read one field from a photo of a Pakistani national identity card (CNIC). You reply with that field only, as JSON.'

export const ADDRESS_READ_PROMPT = [
  'This is a photo of the BACK of a Pakistani CNIC.',
  'Find the PRESENT address (موجودہ پتہ). If only one address is printed, use it.',
  'Write it in English letters (Roman Urdu transliteration is fine), keeping house numbers, streets, areas and the city.',
  'Reply with ONLY this JSON and nothing else: {"address": "<the address>", "city": "<the city or district>"}',
  'If the address is not visible, is cut off, is blurred, or you are not sure, reply with exactly: none',
  'Do not guess. Do not add any other words.',
].join('\n')

export const ADDRESS_MIN_LEN = 10
export const ADDRESS_MAX_LEN = 300

/** "Mostly symbols": under this share of letters and digits (spaces aside). */
export const ADDRESS_MIN_ALNUM_SHARE = 0.7

export type AddressReading = { address: string; city: string }

function tidy(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

/** Share of letters/digits among the non-space characters. */
export function alnumShare(s: string): number {
  const chars = [...s.replace(/\s/g, '')]
  if (chars.length === 0) return 0
  const good = chars.filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length
  return good / chars.length
}

/**
 * The model's reply → a checked reading, or null. STRICT: JSON with an address
 * of a sensible length, mostly letters and digits, at least two words, and a
 * city that `resolveCity` knows (taken from the city field, else found in the
 * address itself). Anything else — "none", prose, no city — is nothing.
 */
export function parseAddressReading(reply: string | null | undefined, resolveCity: (typed: string) => string | null): AddressReading | null {
  let text = (reply ?? '').trim()
  if (!text || /^none\.?$/i.test(text)) return null
  // A fenced reply ("```json … ```") is still the JSON.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const address = tidy((obj as Record<string, unknown>).address)
  const cityRaw = tidy((obj as Record<string, unknown>).city)
  if (address.length < ADDRESS_MIN_LEN || address.length > ADDRESS_MAX_LEN) return null
  if (/^none\b/i.test(address)) return null
  if (alnumShare(address) < ADDRESS_MIN_ALNUM_SHARE) return null
  if (address.split(' ').filter((w) => /\p{L}{2,}/u.test(w)).length < 2) return null
  const city = (cityRaw ? resolveCity(cityRaw) : null) ?? cityInText(address, resolveCity)
  if (!city) return null
  return { address, city }
}

/** A known city named inside the address ("…, Gulberg III, Lahore"). Tries the
 *  comma parts from the end, then two- and one-word runs. */
export function cityInText(address: string, resolveCity: (typed: string) => string | null): string | null {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean).reverse()
  for (const p of parts) {
    const hit = resolveCity(p)
    if (hit) return hit
  }
  const words = address.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    if (i > 0) {
      const two = resolveCity(`${words[i - 1]} ${words[i]}`)
      if (two) return two
    }
    if (words[i].length >= 3) {
      const one = resolveCity(words[i])
      if (one) return one
    }
  }
  return null
}

export type SuggestionStatus = 'unconfirmed' | 'confirmed' | 'edited' | 'superseded'

/**
 * Should a fresh reading be saved as the member's suggestion?
 *   'has_address' — the member already entered an address: never touched;
 *   'decided'     — the member already confirmed or edited one: kept;
 *   'save'        — no address, and no suggestion or only an unconfirmed one.
 */
export function suggestionDecision(p: { currentAddress: string | null | undefined; existing: SuggestionStatus | null | undefined }): 'has_address' | 'decided' | 'save' {
  if ((p.currentAddress ?? '').trim()) return 'has_address'
  if (p.existing === 'confirmed' || p.existing === 'edited') return 'decided'
  return 'save'
}

export type AddressSuggestion = { address: string; city: string; status: SuggestionStatus }

/** What the member's Home address box shows: a pending suggestion only while
 *  they have no address of their own. */
export function memberSuggestion(currentAddress: string | null | undefined, s: AddressSuggestion | null | undefined): AddressSuggestion | null {
  if ((currentAddress ?? '').trim()) return null
  return s && s.status === 'unconfirmed' ? s : null
}

// ------------------------------------------------------------- staff side ---

export const ADDRESS_LABEL_READ = 'Read from CNIC — not confirmed'
export const ADDRESS_LABEL_CONFIRMED = 'Confirmed by member'

export type StaffAddress = {
  /** Masked: never the address itself. */
  masked: string
  label: typeof ADDRESS_LABEL_READ | typeof ADDRESS_LABEL_CONFIRMED
  /** Which value a Show returns. */
  source: 'member' | 'cnic'
} | null

/** The address on file, as an admin screen receives it. The member's own
 *  address (typed, confirmed or edited) wins; otherwise a pending suggestion. */
export function staffAddress(currentAddress: string | null | undefined, city: string | null | undefined, s: AddressSuggestion | null | undefined): StaffAddress {
  if ((currentAddress ?? '').trim()) return { masked: maskAddress(city), label: ADDRESS_LABEL_CONFIRMED, source: 'member' }
  if (s && s.status === 'unconfirmed') return { masked: maskAddress(s.city), label: ADDRESS_LABEL_READ, source: 'cnic' }
  return null
}

/** "•••••• (Lahore)" — the city only; the street never leaves the server. */
export function maskAddress(city: string | null | undefined): string {
  const c = tidy(city)
  return c ? `•••••• (${c})` : '••••••'
}

// ------------------------------------------------------------ member side ---

export const ADDRESS_FROM_CNIC_NOTE = 'We read this from your CNIC. Is this your current address?'

/** Confirm needs a pending suggestion; Edit needs a real address. */
export function addressSaveRefusal(action: 'confirm' | 'edit', p: { suggestion: AddressSuggestion | null; text?: string | null }): string | null {
  if (action === 'confirm') return p.suggestion ? null : 'There is no address to confirm. Type your address and press Save.'
  const t = tidy(p.text)
  if (t.length < 5) return 'Type your full home address.'
  if (t.length > 500) return 'That address is too long. Keep it under 500 characters.'
  return null
}

// --------------------------------------------------------------- the read ---

export type AddressReadResult =
  | { status: 'saved' }
  /** Read, nothing usable (empty, no city, mostly symbols): nothing saved. */
  | { status: 'none' }
  /** The member has an address, or already decided: nothing read. */
  | { status: 'skipped' }
  /** This image was already read. */
  | { status: 'already_read' }
  /** The reader could not run (no key, a timeout, no image): can be retried. */
  | { status: 'unavailable' }

export type VisionReply = { ok: true; text: string } | { ok: false; reason: string }

/** The read, every side effect injected. The ONLY writes are `claim`,
 *  `release` (on the document row) and `save` (the suggestion). */
export async function runAddressRead(deps: {
  /** Has the member an address, or a decided suggestion? Checked before any cost. */
  decision: () => Promise<'has_address' | 'decided' | 'save'>
  /** Stamp the document read. False when it was already read or is being read. */
  claim: () => Promise<boolean>
  release: () => Promise<void>
  loadImage: () => Promise<{ mediaType: 'image/jpeg'; base64: string } | null>
  vision: (image: { mediaType: 'image/jpeg'; base64: string }) => Promise<VisionReply>
  resolveCity: (typed: string) => string | null
  /** Save the suggestion (re-checks the decision at write time). */
  save: (r: AddressReading) => Promise<void>
}): Promise<AddressReadResult> {
  if ((await deps.decision()) !== 'save') return { status: 'skipped' }
  if (!(await deps.claim())) return { status: 'already_read' }
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
    const reading = parseAddressReading(reply.text, deps.resolveCity)
    if (!reading) return { status: 'none' }
    await deps.save(reading)
    return { status: 'saved' }
  } catch {
    await deps.release().catch(() => {})
    return { status: 'unavailable' }
  }
}
