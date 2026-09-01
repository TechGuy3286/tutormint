// lib/masking.ts
//
// Phone-number masking in message bodies.
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
// catch that. It is deliberately tuned to Pakistani mobile formats and to
// avoid destroying ordinary text -- a false positive that redacts "I can do
// 2000 per month" is worse than a miss.

/**
 * Pakistani mobile numbers, in the shapes people actually type them:
 *
 *   03001234567      03 00 123 45 67      0300-1234567
 *   +923001234567    +92 300 1234567      92 300 123 4567
 *   00923001234567
 *
 * The separator class allows spaces, dashes, dots and thin punctuation between
 * any two digits, which is how a number gets typed when someone is trying not
 * to be spotted. A run must still resolve to a plausible 10-11 digit national
 * number, so years, prices and CNIC fragments are left alone.
 */
const SEP = '[\\s.\\-_()]*'

const PATTERNS: RegExp[] = [
  // +92 / 0092 / 92 followed by a 3xx mobile prefix and 7 more digits
  new RegExp(`(?:\\+|00)?${SEP}9${SEP}2${SEP}3(?:${SEP}\\d){9}`, 'g'),
  // 03xx-xxxxxxx national form (11 digits starting 03)
  new RegExp(`0${SEP}3(?:${SEP}\\d){9}`, 'g'),
]

/** A run of 9+ bare digits is a number however it was framed. */
const LONG_DIGIT_RUN = new RegExp(`\\d(?:${SEP}\\d){8,}`, 'g')

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

  for (const re of [...PATTERNS, LONG_DIGIT_RUN]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const digits = m[0].replace(/\D/g, '')
      // 10 digits covers "3001234567" written without the leading zero;
      // 15 is the E.164 ceiling. Anything outside that is not a phone number.
      if (digits.length >= 10 && digits.length <= 15) {
        spans.push({ start: m.index, end: m.index + m[0].length })
      }
      if (m.index === re.lastIndex) re.lastIndex++ // zero-width guard
    }
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
