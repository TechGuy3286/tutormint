// lib/postRedactCore.ts — PURE, browser-safe (owner, 23 Nov 2026 — PR-18 A.2).
//
// The parent's phone number is NEVER sent to the AI. The browser takes every
// number out of a pasted post with a local regex FIRST, puts the first mobile
// into the form itself, and sends the AI only the text with placeholders. The
// server runs the same redaction again before the call (belt and braces), and
// refuses to call the AI if anything number-shaped is left.
//
// Caught: Pakistani mobiles in any format (lib/masking findPhoneSpans: 03xx…,
// +92 3xx…, 923xx…, spaces / dashes / dots), CNIC-shaped numbers, any other run
// of 10 or more digits (a landline with its code), and email addresses.

import { findPhoneSpans } from '@/lib/masking'
import { normalisePkMobile } from '@/lib/phone'

export const PHONE_PLACEHOLDER = (n: number) => `[PHONE_${n}]`
export const EMAIL_PLACEHOLDER = '[EMAIL]'

const LONG_DIGITS = /\+?\d[\d\s\-().]{8,}\d/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export type Redacted = {
  /** The text with every number and email replaced — the only thing the AI sees. */
  text: string
  /** The Pakistani mobiles found, as MSISDNs (923001234567), in order, no repeats. */
  mobiles: string[]
  /** How many numbers were taken out (mobiles + other long digit runs). */
  removed: number
}

type Span = { start: number; end: number }

function digitCount(s: string): number {
  return s.replace(/\D/g, '').length
}

/** "15000-20000", "5000 - 8000": a fee range (two parts of at most 6 digits), not a number. */
const RANGE = /^\d{1,6}\s*[-–]\s*\d{1,6}$/

/** A run of 10+ digits that is a contact number, not a fee range. */
function isLongNumber(s: string): boolean {
  return digitCount(s) >= 10 && !RANGE.test(s.trim())
}

export function redactForAi(raw: string): Redacted {
  const text = String(raw ?? '')
  const spans: Span[] = findPhoneSpans(text).map((s) => ({ start: s.start, end: s.end }))
  LONG_DIGITS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LONG_DIGITS.exec(text)) !== null) {
    if (isLongNumber(m[0])) spans.push({ start: m.index, end: m.index + m[0].length })
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  const mobiles: string[] = []
  let out = ''
  let at = 0
  let n = 0
  for (const s of merged) {
    const piece = text.slice(s.start, s.end)
    const msisdn = normalisePkMobile(piece)
    if (msisdn && !mobiles.includes(msisdn)) mobiles.push(msisdn)
    n++
    out += text.slice(at, s.start) + PHONE_PLACEHOLDER(n)
    at = s.end
  }
  out += text.slice(at)
  out = out.replace(EMAIL, EMAIL_PLACEHOLDER)
  return { text: out, mobiles, removed: n }
}

/** Is anything number-shaped (a mobile, a CNIC, 10+ digits) still in this text? */
export function hasNumberLeft(text: string): boolean {
  if (findPhoneSpans(text).length > 0) return true
  LONG_DIGITS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LONG_DIGITS.exec(text)) !== null) if (isLongNumber(m[0])) return true
  return false
}
