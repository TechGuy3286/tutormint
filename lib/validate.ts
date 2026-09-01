// lib/validate.ts
//
// One way to read a request body, and one shape of 400 when it is wrong.
//
// Before this, every route hand-rolled its checks: some returned
// {error: 'Missing demo.'}, some returned a raw Postgres message, and a few
// passed unvalidated values straight into a query. Two things follow from
// putting it in one place --
//
//   * The UI can rely on the shape. Every failure is
//     { error: string, fields?: Record<string, string> } with a 400, so a form
//     can show `error` at the top and `fields` beside the inputs without
//     knowing which route it called.
//
//   * The message is written for the person, not the parser. Zod says
//     "Invalid input: expected string, received number"; a parent filling in a
//     budget should read "Fee should be a number, like 8000." The schemas below
//     carry those messages, and humanise() catches whatever slips through.
//
// Nothing here logs the body. Request bodies contain CNIC numbers, phone
// numbers and message text.

import { NextResponse } from 'next/server'
import { z, type ZodType } from 'zod'

export { z }

export type ValidationFailure = {
  ok: false
  response: NextResponse
}

export type ValidationSuccess<T> = {
  ok: true
  data: T
}

export type Validated<T> = ValidationSuccess<T> | ValidationFailure

/**
 * Zod's own default messages, which must never reach a member.
 *
 * Zod always populates `message`, so `issue.message || humanise(issue)` never
 * falls through -- it just forwards "Invalid input: expected string, received
 * undefined" to somebody filling in a form. Recognising the defaults is what
 * makes humanise() reachable, and a schema that sets its own message still
 * wins, which is the point.
 */
function isZodDefault(msg: string): boolean {
  return (
    /^Invalid input/i.test(msg) ||
    /^Invalid option/i.test(msg) ||
    /^Too (small|big)/i.test(msg) ||
    /^Expected /i.test(msg) ||
    /^Required$/i.test(msg) ||
    /^Unrecognized key/i.test(msg)
  )
}

function message(issue: z.core.$ZodIssue): string {
  return !issue.message || isZodDefault(issue.message) ? humanise(issue) : issue.message
}

/** Turn a Zod issue into something worth showing a member. */
function humanise(issue: z.core.$ZodIssue): string {
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : 'That value'

  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined || issue.input === null
        ? `${label(field)} is required.`
        : `${label(field)} is not in the right format.`
    case 'too_small':
      return `${label(field)} is too short.`
    case 'too_big':
      return `${label(field)} is too long.`
    case 'invalid_format':
      return `${label(field)} is not in the right format.`
    case 'invalid_value':
      return `${label(field)} is not one of the allowed values.`
    default:
      return issue.message || `${label(field)} is not valid.`
  }
}

/** "jobId" -> "Job id"; "message" -> "Message". */
function label(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Read and validate a JSON body.
 *
 * Returns either the parsed value or a ready-made 400 response — the caller
 * writes `if (!parsed.ok) return parsed.response`, which is one line and hard
 * to get wrong, rather than a try/catch and a hand-written error each time.
 */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<Validated<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'We could not read that request. Please try again.' },
        { status: 400 },
      ),
    }
  }

  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }

  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    // First message per field wins: a field with three problems still gets one
    // sentence, because three stacked messages under one input is noise.
    if (!(key in fields)) fields[key] = message(issue)
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: message(result.error.issues[0]), fields },
      { status: 400 },
    ),
  }
}

/** Same, for query strings. */
export function parseQuery<T>(url: URL, schema: ZodType<T>): Validated<T> {
  const raw: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    raw[k] = v
  })

  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }

  return {
    ok: false,
    response: NextResponse.json({ error: message(result.error.issues[0]) }, { status: 400 }),
  }
}

// ---------------------------------------------------------------------------
// Shared field shapes. Defined once so "what counts as a valid CNIC" has one
// answer across the profile form, the verification queue and the API.
// ---------------------------------------------------------------------------

/**
 * An id from our own tables.
 *
 * guid(), NOT uuid(). Zod 4's uuid() enforces the RFC 4122 version and variant
 * bits, and not every id in this database has them: the development seed cast
 * uses readable ids like 11111111-1111-1111-1111-111111111111, which are real
 * rows that real requests carry. Rejecting those at the API edge would mean
 * every seeded account failing validation on ids the database itself issued.
 *
 * The question being asked here is "is this the shape of one of our ids", and
 * the database answers the rest — an id that is well-formed but does not exist
 * returns 404 from the query, which is the correct answer anyway.
 */
export const uuid = z.guid('That link is not valid.')

/**
 * Pakistani mobile, in any shape a person types it.
 *
 * Normalisation belongs here rather than in each form: "0300 1234567",
 * "+92 300 1234567" and "03001234567" are the same number, and a member who
 * types the one with spaces should not be told it is wrong.
 */
export const pkMobile = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .refine((s) => /^(?:\+?92|0)3\d{9}$/.test(s), {
    message: 'Enter a Pakistani mobile number, like 0300 1234567.',
  })

/** CNIC, 5-7-1. Dashes optional on input, stripped on the way through. */
export const cnic = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .refine((s) => /^\d{13}$/.test(s), {
    message: 'Enter your CNIC as 13 digits, like 35201-1234567-8.',
  })

/**
 * A fee or budget in rupees.
 *
 * Accepts "8000", "8,000", "8k" and "Rs 8000", because those are all things
 * people actually type into a box labelled "budget". The UI confirms the
 * interpreted figure back to them before it is saved.
 */
export const rupees = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === 'number') return v
    const cleaned = v.trim().toLowerCase().replace(/rs\.?|,|\s/g, '')
    const k = cleaned.match(/^(\d+(?:\.\d+)?)k$/)
    if (k) return Math.round(parseFloat(k[1]) * 1000)
    return Number(cleaned)
  })
  .refine((n) => Number.isFinite(n) && n >= 0, {
    message: 'Enter the fee as a number, like 8000.',
  })

/** Free text a member typed. Trimmed, length-bounded, Urdu welcome. */
export function text(opts: { min?: number; max: number; label: string }) {
  return z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= (opts.min ?? 0), {
      message:
        (opts.min ?? 0) <= 1
          ? `${opts.label} is required.`
          : `${opts.label} needs to be at least ${opts.min} characters.`,
    })
    .refine((s) => s.length <= opts.max, {
      message: `${opts.label} is too long — keep it under ${opts.max} characters.`,
    })
}
