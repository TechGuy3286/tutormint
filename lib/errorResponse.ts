// lib/errorResponse.ts
//
// The server side of the one error path (PR72 §B). An UNEXPECTED failure inside
// an API route is logged once with a short reference code and NEVER echoed to
// the caller — the response carries the plain generic message and the same
// reference so support can find the log line. Known, safe cases (validation, a
// stated rule like "Minimum can't be higher than maximum") keep their own plain
// message and do NOT go through here.
//
// Nothing sensitive is logged: the error and a short context string only — no
// request body, no credentials, no tokens, no personal data.

import 'server-only'
import { NextResponse } from 'next/server'
import { GENERIC_ERROR, LOCKED_FIELD_MESSAGE, makeRefCode } from '@/lib/errorMessages'

/** The SQLSTATE the field-lock triggers raise (migration 116). */
const LOCK_SQLSTATE = 'TMLCK'

/**
 * Log an unexpected error with a reference code and return a plain 500. The
 * body is `{ error, ref }` — the form shows `error` (plain English; the client
 * adds the Urdu line and WhatsApp link) and the `ref` so support can trace it.
 *
 * A field-lock error (PR72 §E) is a KNOWN, safe case: it returns the plain
 * "contact support" message with a 403, not the generic 500.
 */
export function serverError(error: unknown, context: string, status = 500): NextResponse {
  const code = (error as { code?: string } | null)?.code
  if (code === LOCK_SQLSTATE) {
    return NextResponse.json({ error: LOCKED_FIELD_MESSAGE.en, errorUr: LOCKED_FIELD_MESSAGE.ur, locked: true }, { status: 403 })
  }
  const ref = makeRefCode()
  // One line, no PII: the ref, a short context tag, and the error itself. In
  // production this is the only place the real message survives.
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error(`[error ${ref}] ${context} — ${detail}`)
  // errorUr so every screen can show the plain Urdu line beside the English one
  // (PR75 §2); ref so the member can quote it to support.
  return NextResponse.json({ error: GENERIC_ERROR.en, errorUr: GENERIC_ERROR.ur, ref }, { status })
}
