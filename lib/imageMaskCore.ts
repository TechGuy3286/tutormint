// lib/imageMaskCore.ts — PURE (owner, 24 Nov 2026 — PR-20 Part C).
//
// PR-22 (Owner decision, option B): "Read from image" no longer masks — the
// AI may read the number printed on a public poster/screenshot, and OCR is the
// second reader it is compared with (`ocrMobiles` below, lib/imageNumberCore).
// The shape rules here are what OCR uses to find that number; the description
// below is how PR-20/21 used them to black numbers out.
//
// "Read from image" on staff Post a tuition. The AI never receives a phone
// number (PR-18), so before an image goes to it the SERVER reads the image
// with plain OCR (tesseract, no AI), finds every number-shaped piece of text
// and its box, and blacks those boxes out. This file decides WHICH boxes:
//
//   - every word that is part of a Pakistani mobile, a CNIC shape, any other
//     run of 10+ digits, or an email address — the same shapes the text
//     redaction catches (lib/postRedactCore numberSpans / emailSpans), read
//     line by line so "0321 - 5872222" split over three words is one number;
//   - any single word with 7+ digits (half a number is still a number);
//   - on a line that says WhatsApp / call / contact / phone / cell / mob…,
//     every word with 3+ digits — a poster's contact line is masked whole even
//     when OCR misread part of it (a fee on that line may be lost; staff type it).
//
// OCR mixes up letters and digits ("O321", "l" for 1), so a mostly-digit word
// has its look-alike letters read as digits before the test.
//
// Urdu digits (owner, 24 Nov 2026 — PR-21): the Urdu OCR model reads ۰–۹ but
// also invents digits on English text, so its digit words count only where the
// English model did NOT read a confident English word (`urduDigitWords`). A
// line holding 7+ such digits is masked; 7+ still readable after masking → the
// AI is not called.
//
// `numberLeft` is the after-check: the masked image is read again and the AI is
// only called when nothing number-shaped is left (lib/imageRead).

import { normalisePkMobile } from '@/lib/phone'
import { asciiDigits, emailSpans, numberSpans, type Span } from '@/lib/postRedactCore'

export { asciiDigits }

export type Box = { x0: number; y0: number; x1: number; y1: number }
/** `conf`: the OCR's own confidence for the word, 0–100, when known. */
export type OcrWord = { text: string; box: Box; conf?: number }
/** `contactLine`: a line read by the Urdu model that names a contact word — every
 *  word on it with a digit is masked (the Urdu model invents digits on English
 *  text, so its lines are used ONLY when they say رابطہ / نمبر / واٹس… — see
 *  `urduContactLines`). `urduDigits`: the Urdu model's digit words that are not
 *  on a confident English word (`urduDigitWords`). */
export type OcrLine = { words: OcrWord[]; contactLine?: boolean; urduDigits?: boolean }

const URDU_CONTACT = /رابطہ|رابطه|نمبر|واٹس|واٹس ایپ|فون|کال|موبائل/

/** The Urdu model's lines that are safe to use: those with an Urdu contact word. */
export function urduContactLines(lines: OcrLine[]): OcrLine[] {
  return lines.filter((l) => URDU_CONTACT.test(l.words.map((w) => w.text).join(' '))).map((l) => ({ ...l, contactLine: true }))
}

const hasAnyDigit = (s: string) => /\d/.test(asciiDigits(s))

/** The upload the server accepts. The browser always shrinks the picture first
 *  (≤ 2000 px JPEG, usually under 1.5 MB); Vercel refuses requests over 4.5 MB. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024
/** The largest picture the browser will try to shrink (a phone camera photo fits). */
export const IMAGE_PICK_MAX_BYTES = 30 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_UNSAFE = "Couldn't read this image safely — please type the details."
export const IMAGE_TOO_BIG = 'This image is too large — try a screenshot instead.'
export const IMAGE_WRONG_TYPE = "This photo type isn't supported — please use a screenshot (PNG or JPG)."
export const IMAGE_TOO_SLOW = 'Took too long — please try again.'

const LOOKALIKE: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2', S: '5', s: '5', B: '8', b: '6', g: '9', q: '9' }

const digitsIn = (s: string) => (asciiDigits(s).match(/\d/g) ?? []).length

/** Digits on one line, read by the Urdu model away from confident English
 *  words, that are masked — and that stop the AI if still readable after
 *  masking. 7 = half a number is still a number (a 10+ run always passes it). */
export const URDU_DIGIT_MIN = 7
const ENG_CONFIDENT = 70

const boxArea = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const boxOverlap = (a: Box, b: Box) =>
  boxArea({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) })

/**
 * The Urdu model's digit words that are NOT on top of a word the English model
 * read confidently (conf ≥ 70, two letters or digits) — that is where real
 * Urdu digits (۰۳۰۰ ۱۲۳۴۵۶۷) are, and not the digits the Urdu model invents on
 * English text. One line per Urdu line that has any, flagged `urduDigits`.
 */
export function urduDigitWords(urdu: OcrLine[], eng: OcrLine[]): OcrLine[] {
  const confident = eng.flatMap((l) => l.words).filter((x) => (x.conf ?? 0) >= ENG_CONFIDENT && /[A-Za-z0-9]{2,}/.test(x.text))
  const out: OcrLine[] = []
  for (const line of urdu) {
    const words = line.words.filter(
      (u) => hasAnyDigit(u.text) && !confident.some((e) => boxOverlap(u.box, e.box) > 0.3 * Math.max(1, boxArea(u.box))),
    )
    if (words.length > 0) out.push({ words, urduDigits: true })
  }
  return out
}

const urduLineDigits = (line: OcrLine) => line.words.reduce((n, x) => n + digitsIn(x.text), 0)

/**
 * A word with Urdu digits read as 0–9 and its look-alike letters read as
 * digits — the letters only when the word is mostly digits already (so
 * "School" stays "School"). Same length, so positions line up with the word.
 */
export function digitLookalikes(raw: string): string {
  const word = asciiDigits(raw)
  const d = digitsIn(word)
  const alnum = (word.match(/[A-Za-z0-9|!]/g) ?? []).length
  // Mostly digits already, or made ONLY of digits and look-alike letters with at
  // least one real digit ("O3OO", "l234567").
  const onlyLookalikes = d >= 1 && word.length >= 3 && /^[0-9OoDQlIi|!ZzSsBbgq+\-().]+$/.test(word)
  if (!onlyLookalikes && (d < 3 || d / Math.max(1, alnum) < 0.6)) return word
  return word.replace(/[OoDQlIi|!ZzSsBbgq]/g, (c) => LOOKALIKE[c] ?? c)
}

const CONTACT_WORDS = /whats\s*app|whatsapp|wa\b|call|contact|phone|cell|mob(?:ile)?\b|tel\b|ph\b|number|no\.?\s*:|رابطہ|واٹس|فون|نمبر|کال/i

export type MaskPlan = {
  /** The boxes to black out, padded, clipped to the image. */
  boxes: Box[]
  /** Pakistani mobiles found, as MSISDNs (923001234567), first first, no repeats. */
  mobiles: string[]
  /** How many number / email pieces were found (0 = none seen). */
  found: number
}

function overlaps(a: Span, b: Span) {
  return a.start < b.end && b.start < a.end
}

/** Pad a word box (a quarter of its height each side) and clip it to the image. */
export function padBox(b: Box, w: number, h: number): Box {
  const pad = Math.max(4, Math.round((b.y1 - b.y0) * 0.25))
  return {
    x0: Math.max(0, b.x0 - pad),
    y0: Math.max(0, b.y0 - pad),
    x1: Math.min(w, b.x1 + pad),
    y1: Math.min(h, b.y1 + pad),
  }
}

/** Which words to black out, and the mobiles found, for OCR lines of an image w × h. */
export function planMask(lines: OcrLine[], w: number, h: number): MaskPlan {
  const boxes: Box[] = []
  const mobiles: string[] = []
  let found = 0
  for (const line of lines) {
    const words = line.words.filter((x) => x.text.trim().length > 0).sort((a, b) => a.box.x0 - b.box.x0)
    if (words.length === 0) continue
    if (line.urduDigits) {
      if (urduLineDigits(line) >= URDU_DIGIT_MIN) {
        found++
        for (const x of words) boxes.push(padBox(x.box, w, h))
      }
      continue
    }
    if (line.contactLine) {
      const digitWords = words.filter((x) => hasAnyDigit(x.text))
      if (digitWords.length > 0) found++
      for (const x of digitWords) boxes.push(padBox(x.box, w, h))
      continue
    }
    // The line's text with each word's position, look-alikes read as digits.
    let text = ''
    const at: Span[] = []
    for (const word of words) {
      if (text) text += ' '
      const t = digitLookalikes(word.text.trim())
      at.push({ start: text.length, end: text.length + t.length })
      text += t
    }
    const hit = new Set<number>()
    const spans = [...numberSpans(text), ...emailSpans(text)]
    found += spans.length
    for (const s of numberSpans(text)) {
      const m = normalisePkMobile(text.slice(s.start, s.end))
      if (m && !mobiles.includes(m)) mobiles.push(m)
    }
    spans.forEach((s) => at.forEach((a, i) => overlaps(a, s) && hit.add(i)))
    const contactLine = CONTACT_WORDS.test(line.words.map((x) => x.text).join(' '))
    words.forEach((word, i) => {
      const d = digitsIn(digitLookalikes(word.text))
      if (d >= 7) {
        hit.add(i)
        if (!spans.some((s) => overlaps(at[i], s))) found++
      } else if (contactLine && d >= 3) hit.add(i)
    })
    for (const i of [...hit].sort((a, b) => a - b)) boxes.push(padBox(words[i].box, w, h))
  }
  return { boxes, mobiles, found }
}

/** After masking: is anything number-shaped still readable? (Any line with a
 *  number / email shape, or any word with 7+ digits.) */
export function numberLeft(lines: OcrLine[]): boolean {
  for (const line of lines) {
    if (line.urduDigits) {
      if (urduLineDigits(line) >= URDU_DIGIT_MIN) return true
      continue
    }
    if (line.contactLine) {
      if (line.words.some((x) => hasAnyDigit(x.text))) return true
      continue
    }
    const words = line.words.map((x) => digitLookalikes(x.text.trim())).filter(Boolean)
    const text = words.join(' ')
    if (numberSpans(text).length > 0 || emailSpans(text).length > 0) return true
    if (words.some((x) => digitsIn(x) >= 7)) return true
  }
  return false
}

/** The OCR text of an image as plain lines (for the AI, after redaction). */
export function linesText(lines: OcrLine[]): string {
  return lines.map((l) => l.words.map((x) => x.text).join(' ').trim()).filter(Boolean).join('\n')
}

/** The black boxes as one SVG the size of the image (composited by sharp). */
export function maskSvg(boxes: Box[], w: number, h: number): string {
  const rects = boxes
    .map((b) => `<rect x="${Math.floor(b.x0)}" y="${Math.floor(b.y0)}" width="${Math.ceil(b.x1 - b.x0)}" height="${Math.ceil(b.y1 - b.y0)}" fill="black"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`
}

/** Is this an image type we read? (The server also checks the file's own bytes.) */
export function imageTypeOk(type: string | null | undefined): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(String(type ?? '').toLowerCase())
}

/**
 * PR-22: the mobiles OCR read on an image, for "Read from image" (lib/imageRead
 * — the AI reads the image unmasked now; OCR is the second reader that the
 * AI's number is compared against, lib/imageNumberCore). English lines as
 * planMask reads them; Urdu-model lines (contact lines, Urdu digit words) as
 * one run of digits, marked `urdu` when written in Urdu digits.
 */
export function ocrMobiles(lines: OcrLine[]): { msisdn: string; urdu: boolean }[] {
  const out: { msisdn: string; urdu: boolean }[] = []
  const add = (msisdn: string | null, urdu: boolean) => {
    if (!msisdn) return
    const had = out.find((m) => m.msisdn === msisdn)
    if (had) had.urdu = had.urdu || urdu
    else out.push({ msisdn, urdu })
  }
  for (const line of lines) {
    if (line.urduDigits || line.contactLine) {
      const raw = line.words.filter((x) => hasAnyDigit(x.text)).map((x) => x.text).join('')
      add(normalisePkMobile(asciiDigits(raw)), /[۰-۹٠-٩]/.test(raw))
      continue
    }
    for (const m of planMask([line], 1, 1).mobiles) add(m, false)
  }
  return out
}
