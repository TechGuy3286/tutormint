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
//
// Urdu / Arabic-Indic digits (۰–۹, ٠–٩) count exactly like 0–9 (owner, 24 Nov
// 2026 — PR-21): every test runs on the text with them read as 0–9 (one
// character for one, so positions hold), and the redacted text and the mobiles
// found come out in English digits — "رابطہ ۰۳۰۰-۱۲۳۴۵۶۷" is caught and goes into
// the form as 923001234567.

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

export type Span = { start: number; end: number }

/** Urdu / Arabic-Indic digits (۰–۹, ٠–٩) as 0–9 — one character each, so positions hold. */
export function asciiDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
}

function digitCount(s: string): number {
  return s.replace(/\D/g, '').length
}

/** "15000-20000", "5000 - 8000": a fee range (two parts of at most 6 digits), not a number. */
const RANGE = /^\d{1,6}\s*[-–]\s*\d{1,6}$/

/** A run of 10+ digits that is a contact number, not a fee range. */
function isLongNumber(s: string): boolean {
  return digitCount(s) >= 10 && !RANGE.test(s.trim())
}

/**
 * Where the numbers are: every Pakistani mobile, CNIC shape and other run of
 * 10+ digits in `text`, merged and in order. (Emails are separate —
 * `emailSpans`.) Shared by the text redaction below and the image masking
 * (lib/imageMaskCore, PR-20), so both catch exactly the same shapes.
 */
export function numberSpans(raw: string): Span[] {
  const text = asciiDigits(raw)
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
  return merged
}

/** Where the email addresses are in `text`. */
export function emailSpans(raw: string): Span[] {
  const text = asciiDigits(raw)
  const out: Span[] = []
  const re = new RegExp(EMAIL.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length })
  return out
}

export function redactForAi(raw: string): Redacted {
  const text = asciiDigits(String(raw ?? ''))
  const merged = numberSpans(text)
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
export function hasNumberLeft(raw: string): boolean {
  const text = asciiDigits(raw)
  if (findPhoneSpans(text).length > 0) return true
  LONG_DIGITS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LONG_DIGITS.exec(text)) !== null) if (isLongNumber(m[0])) return true
  return false
}
