// lib/masking.ts
//
// Phone-number (and CNIC) masking in message bodies.
//
// The rule from CLAUDE.md: "message bodies are scanned server-side for phone
// number patterns; when either participant lacks contact rights, matched
// digits render masked with an upgrade chip. Store original, render masked;
// unmask automatically when rights exist."
//
// Why store the original: masking is a business rule about who may see a
// number today, not a moderation decision about the message. If the reader
// upgrades tomorrow, the same message unmasks -- and if a thread is ever
// reported, the admin queue needs the real text. Destroying the digits at
// write time would make both impossible.
//
// Why mask on the server: doing it in the browser would ship the digits to the
// client and hide them with CSS. The masked string is produced here, and the
// original never leaves the server unless the reader is entitled to it.
//
// This is a deterrent against casual contact-swapping, not a guarantee. Anyone
// determined can spell a number out in words, and no regular expression will
// catch that. It is deliberately tuned to Pakistani mobile / CNIC formats and,
// above all, to avoid destroying ordinary text -- a false positive that redacts
// "My budget is 15000-20000" is worse than a miss.
//
// TWO WAYS A NUMBER IS CAUGHT, and the difference is what stopped fee ranges
// from masking:
//
//   * PATTERNS are STRUCTURAL — a 923xx / 03xx mobile with the right prefix and
//     length. They still fire on a mobile embedded in a longer sentence, so a
//     number wedged between prices is caught even though the whole run is not a
//     phone number.
//   * A CANDIDATE run (digits + the usual separators) is masked only when its
//     SHAPE, once separators are stripped, IS a Pakistani mobile or a CNIC. This
//     replaced a bare "10+ digits in a row" test, which matched every hyphenated
//     fee range ("15000-20000"), space-separated price list ("2000 2500 3000")
//     and run of years ("2019 2020 2021") — the most common things typed in a
//     parent-tutor thread. The shape test is anchored to the WHOLE cleaned run,
//     so a range never matches: 1500020000 does not start 3, is not 13 digits.

const SEP = '[\\s.\\-_()]*'

const PATTERNS: RegExp[] = [
  // +92 / 0092 / 92 followed by a 3xx mobile prefix and 7 more digits
  new RegExp(`(?:\\+|00)?${SEP}9${SEP}2${SEP}3(?:${SEP}\\d){9}`, 'g'),
  // 03xx-xxxxxxx national form (11 digits starting 03)
  new RegExp(`0${SEP}3(?:${SEP}\\d){9}`, 'g'),
]

/**
 * A maximal run of digits with the usual separators (and an optional leading +
 * or 00), to be shape-tested rather than length-tested. Ends on a digit so no
 * trailing separator is swallowed into the masked span.
 */
const CANDIDATE = /\+?\d(?:[\s.\-_()]*\d)*/g

/**
 * The candidate's shape once separators are stripped. Mask only these:
 *
 *   MOBILE — a Pakistani mobile in any prefix form: bare 3001234567,
 *            0-prefixed 03001234567, or +92 / 92 / 0092 country forms.
 *   CNIC   — the 13-digit national identity number (grouped 5-7-1 when written
 *            out, e.g. 35202-1234567-8), so one pasted into a thread is masked.
 */
const MOBILE_SHAPE = /^(?:00|\+)?(?:92)?0?3\d{9}$/
const CNIC_SHAPE = /^\d{13}$/

export const MASK = '•••••••'

export type MaskResult = {
  /** What to render. Equal to the input when nothing matched. */
  text: string
  /** True when at least one number was hidden. */
  masked: boolean
}

/**
 * Replace phone-like runs with a mask.
 *
 * Matches are collected from every pattern first and then applied by position,
 * so overlapping patterns cannot mask a fragment twice or corrupt offsets.
 */
export function maskPhoneNumbers(input: string | null | undefined): MaskResult {
  const text = input ?? ''
  if (!text) return { text, masked: false }

  type Span = { start: number; end: number }
  const spans: Span[] = []

  // Structural mobile patterns: their own shape is the gate, so any match is a
  // number — including one embedded in a longer sentence.
  for (const re of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length })
      if (m.index === re.lastIndex) re.lastIndex++ // zero-width guard
    }
  }

  // Candidate runs: masked only when the WHOLE cleaned run is a mobile or a
  // CNIC. Separators are stripped; the + is kept because MOBILE_SHAPE allows it.
  CANDIDATE.lastIndex = 0
  let c: RegExpExecArray | null
  while ((c = CANDIDATE.exec(text)) !== null) {
    const cleaned = c[0].replace(/[\s.\-_()]/g, '')
    if (MOBILE_SHAPE.test(cleaned) || CNIC_SHAPE.test(cleaned)) {
      spans.push({ start: c.index, end: c.index + c[0].length })
    }
    if (c.index === CANDIDATE.lastIndex) CANDIDATE.lastIndex++ // zero-width guard
  }

  if (spans.length === 0) return { text, masked: false }

  spans.sort((a, b) => a.start - b.start || b.end - a.end)

  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }

  let out = ''
  let cursor = 0
  for (const s of merged) {
    out += text.slice(cursor, s.start) + MASK
    cursor = s.end
  }
  out += text.slice(cursor)

  return { text: out, masked: true }
}

/**
 * Decide what a reader actually sees.
 *
 * Both sides must have contact rights before a number shows: a Featured parent
 * reading a Verified tutor's message still gets the mask, because the tutor
 * has not bought the right to hand their number over in-thread and the parent
 * has not bought the right to collect it from someone who has not. The rule is
 * about the pair, not the reader.
 */
export function renderMessageBody(
  body: string | null,
  bothSidesMayShareContact: boolean,
): MaskResult {
  if (bothSidesMayShareContact) return { text: body ?? '', masked: false }
  return maskPhoneNumbers(body)
}
