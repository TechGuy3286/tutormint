// lib/imageNumberCore.ts — PURE (owner, 24 Nov 2026 — PR-22 Part A).
//
// "Read from image" only: the AI may read the phone number printed on a
// public poster / screenshot (Owner decision, option B — a stylised number on
// a live poster slipped past OCR, so it was neither masked nor filled). Pasted
// text keeps the strict rule: numbers are taken out before the AI
// (lib/postRedactCore) — nothing here touches that path.
//
// Two readers give a number: plain OCR (tesseract, on the server) and the AI.
// This file decides which one fills the form and what staff are told:
//   - both read the same number → it is used;
//   - they disagree → the AI's number is used, "Check this number";
//   - only one read a number → that one;
//   - written in Urdu digits (either reader says so) → always "Check this
//     number" (Urdu digit order is error-prone).
// The number field is ALWAYS highlighted for staff to check, and every contact
// check (Do not use, erased fingerprint, repeats, the Owner's logged override)
// runs on it before Post is enabled — the same form field as a typed number.

import { normalisePkMobile } from '@/lib/phone'
import { asciiDigits } from '@/lib/postRedactCore'

/** A mobile OCR read: MSISDN (923001234567), and whether it was in Urdu digits. */
export type OcrMobile = { msisdn: string; urdu: boolean }

export type ImageNumberSource = 'both' | 'ai' | 'ocr' | 'none'

export type ImageNumber = {
  /** 03XXXXXXXXX, or null when neither reader found a mobile. */
  phone: string | null
  /** MSISDN of `phone`. */
  msisdn: string | null
  source: ImageNumberSource
  /** Urdu digits were involved — the note says so. */
  urdu: boolean
  /** The line shown under the highlighted number field. */
  note: string
}

export const CHECK_NUMBER = 'Check this number'
export const NOTE_BOTH = `${CHECK_NUMBER} — read from the image.`
export const NOTE_DISAGREE = `${CHECK_NUMBER} — the AI and the text reader read it differently.`
export const NOTE_AI_ONLY = `${CHECK_NUMBER} — read by the AI from the image.`
export const NOTE_OCR_ONLY = `${CHECK_NUMBER} — read from the image.`
export const NOTE_URDU = `${CHECK_NUMBER} — it is written in Urdu digits, which are easy to misread.`
export const NOTE_NONE = 'No phone number was found in the image — type it in.'

/** "0300 1234567", "+92 300-1234567", "۰۳۰۰۱۲۳۴۵۶۷" → MSISDN, else null. */
export function aiMobile(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  return normalisePkMobile(asciiDigits(raw))
}

/** MSISDN → 03XXXXXXXXX (the form's plain format). */
export function localPhone(msisdn: string): string {
  const national = msisdn.startsWith('92') ? msisdn.slice(2) : msisdn
  return `0${national}`
}

const hasUrduDigits = (s: unknown) => typeof s === 'string' && /[۰-۹٠-٩]/.test(s)

/**
 * The number for the form. `ocr` = the mobiles OCR read (null when OCR failed
 * or ran out of time — the AI's number is then used alone). `aiRaw` = the AI's
 * `contactPhone`; `aiUrdu` = the AI said it was written in Urdu digits.
 */
export function pickImageNumber(ocr: OcrMobile[] | null, aiRaw: unknown, aiUrdu: unknown): ImageNumber {
  const ai = aiMobile(aiRaw)
  const ocrList = ocr ?? []
  const urduFromAi = aiUrdu === true || hasUrduDigits(aiRaw)
  let msisdn: string | null = null
  let source: ImageNumberSource = 'none'
  let urdu = false
  if (ai && ocrList.some((m) => m.msisdn === ai)) {
    msisdn = ai
    source = 'both'
    urdu = urduFromAi || ocrList.some((m) => m.msisdn === ai && m.urdu)
  } else if (ai) {
    msisdn = ai
    source = 'ai'
    urdu = urduFromAi
  } else if (ocrList.length > 0) {
    msisdn = ocrList[0].msisdn
    source = 'ocr'
    urdu = ocrList[0].urdu
  }
  if (!msisdn) return { phone: null, msisdn: null, source: 'none', urdu: false, note: NOTE_NONE }
  const disagree = source === 'ai' && ocrList.length > 0
  const note = urdu ? NOTE_URDU : disagree ? NOTE_DISAGREE : source === 'both' ? NOTE_BOTH : source === 'ai' ? NOTE_AI_ONLY : NOTE_OCR_ONLY
  return { phone: localPhone(msisdn), msisdn, source, urdu, note }
}
