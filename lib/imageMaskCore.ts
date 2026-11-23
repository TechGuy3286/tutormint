// lib/imageMaskCore.ts — PURE (owner, 24 Nov 2026 — PR-20 Part C).
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
// `numberLeft` is the after-check: the masked image is read again and the AI is
// only called when nothing number-shaped is left (lib/imageRead).

import { normalisePkMobile } from '@/lib/phone'
import { emailSpans, numberSpans, type Span } from '@/lib/postRedactCore'

export type Box = { x0: number; y0: number; x1: number; y1: number }
export type OcrWord = { text: string; box: Box }
/** `contactLine`: a line read by the Urdu model that names a contact word — every
 *  word on it with a digit is masked (the Urdu model invents digits on English
 *  text, so its lines are used ONLY when they say رابطہ / نمبر / واٹس… — see
 *  `urduContactLines`). */
export type OcrLine = { words: OcrWord[]; contactLine?: boolean }

const URDU_CONTACT = /رابطہ|رابطه|نمبر|واٹس|واٹس ایپ|فون|کال|موبائل/

/** The Urdu model's lines that are safe to use: those with an Urdu contact word. */
export function urduContactLines(lines: OcrLine[]): OcrLine[] {
  return lines.filter((l) => URDU_CONTACT.test(l.words.map((w) => w.text).join(' '))).map((l) => ({ ...l, contactLine: true }))
}

const hasAnyDigit = (s: string) => /\d/.test(asciiDigits(s))

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_UNSAFE = "Couldn't read this image safely, please type the details."
export const IMAGE_TOO_BIG = 'That image is over 8 MB. Use a smaller screenshot.'
export const IMAGE_WRONG_TYPE = 'Use a PNG, JPG or WebP image.'

const LOOKALIKE: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2', S: '5', s: '5', B: '8', b: '6', g: '9', q: '9' }

/** Urdu / Arabic digits (۰–۹, ٠–٩) as 0–9 — one character each, so positions hold. */
export function asciiDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
}

const digitsIn = (s: string) => (asciiDigits(s).match(/\d/g) ?? []).length

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
