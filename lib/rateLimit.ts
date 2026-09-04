// lib/rateLimit.ts
//
// Request rate limiting, in the database rather than in process memory.
//
// On Vercel every request may land on a different lambda, each with its own
// heap. An in-memory counter there does not limit anything -- it limits each
// instance separately, and the platform will happily give an attacker a fresh
// instance. The counter has to live somewhere both instances can see, and the
// database is somewhere we already are.
//
// The cost is one round trip on the limited routes. That is acceptable on
// login, register, OTP, apply and message; it would not be on a browse page,
// which is why those are not limited here.
//
// consume_rate_limit() (migration 28) does the increment and the test in one
// statement. Read-then-write from here would let two concurrent requests both
// see "one left" and both proceed -- which for the OTP bucket means the attempt
// limit is not really a limit.

import { createAdminClient } from '@/lib/supabase/admin'

export type BucketName =
  | 'login'
  | 'register'
  | 'otp_send'
  | 'otp_verify'
  | 'apply'
  | 'message'
  | 'report'
  | 'password_change'
  | 'search'
  | 'ai_generate'
  | 'client_error'

/**
 * The budgets.
 *
 * Two shapes of number here, for two different threats:
 *
 *   Credential buckets (login, otp_verify) are tight, because the attack is
 *   guessing and every extra attempt is a free guess. Ten sign-in attempts an
 *   hour from one address is generous for a person who has forgotten a password
 *   and miserly for a script.
 *
 *   Activity buckets (apply, message) are loose, because the attack is spam and
 *   the honest user genuinely does burst. A tutor working through the job board
 *   on a Sunday evening should never meet this; the plan quota is what actually
 *   governs their volume. This exists to stop a script, not to enforce policy.
 */
const BUDGETS: Record<BucketName, { windowSeconds: number; max: number }> = {
  login: { windowSeconds: 900, max: 10 }, // 10 per 15 min per IP
  register: { windowSeconds: 3600, max: 5 }, // 5 accounts an hour per IP
  otp_send: { windowSeconds: 3600, max: 8 }, // costs real money per message
  otp_verify: { windowSeconds: 900, max: 10 },
  apply: { windowSeconds: 3600, max: 40 },
  message: { windowSeconds: 3600, max: 120 },
  report: { windowSeconds: 3600, max: 20 },
  password_change: { windowSeconds: 3600, max: 10 },
  // A typeahead is chatty by design: one request per 250ms pause, and an
  // honest visitor refining a search genuinely produces dozens a minute. This
  // is sized to stop a scraper walking the directory through the suggest
  // endpoint, not to ration typing. Anyone who meets it is not searching.
  search: { windowSeconds: 60, max: 90 },
  // Writing a job post with the Claude API. Tighter than the other activity
  // buckets and for a different reason: every call costs real money, the way
  // otp_send does. Twenty an hour is far more than a parent posting one
  // tuition needs -- they press Generate, read it, maybe press it again -- and
  // it is nowhere near enough to be worth scripting.
  ai_generate: { windowSeconds: 3600, max: 20 },
  // Swallowed client-side errors (lib/silentFailure.ts). Sized to be generous
  // to a browser that is genuinely having a bad time -- one broken page can
  // legitimately report several distinct failures -- and small enough that a
  // script cannot write our logs for us. The caller is a fire-and-forget
  // beacon and is told nothing when it meets this.
  client_error: { windowSeconds: 3600, max: 60 },
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * Count one request against a bucket.
 *
 * FAILS OPEN. If the database is unreachable the request is allowed through,
 * because the alternative is that a database wobble logs out the entire
 * platform. A rate limiter is a mitigation, not the authentication control --
 * the password check behind it still has to be wrong for anything to happen.
 */
export async function rateLimit(
  bucket: BucketName,
  identifier: string,
): Promise<RateLimitResult> {
  const admin = createAdminClient()
  if (!admin) return { allowed: true }

  const budget = BUDGETS[bucket]

  try {
    const { data, error } = await admin.rpc('consume_rate_limit', {
      p_bucket: bucket,
      p_identifier: identifier.slice(0, 200),
      p_window_seconds: budget.windowSeconds,
      p_max_count: budget.max,
    })

    if (error) {
      console.error('[rateLimit] rpc failed, allowing through:', error.message)
      return { allowed: true }
    }

    return data === false
      ? { allowed: false, retryAfterSeconds: budget.windowSeconds }
      : { allowed: true }
  } catch (e) {
    console.error('[rateLimit] failed, allowing through:', e)
    return { allowed: true }
  }
}

/**
 * The caller's IP, as far as it can be known behind Vercel's proxy.
 *
 * x-forwarded-for is client-controllable in general, but on Vercel the platform
 * overwrites it, so the LEFTMOST entry is the real client. Reading the rightmost
 * (the usual advice behind a proxy you control) would give Vercel's own edge
 * address and put every visitor in one bucket.
 *
 * Falls back to a constant when there is no header at all -- local development.
 * That means one shared bucket in dev, which is the right behaviour: it makes
 * the limit easy to hit deliberately while testing.
 */
export function callerIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'local'
}

/** The standard 429, with a Retry-After the client can act on. */
export function tooManyRequests(retryAfterSeconds: number, what: string): Response {
  const minutes = Math.max(1, Math.round(retryAfterSeconds / 60))
  return new Response(
    JSON.stringify({
      error: `Too many ${what}. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  )
}
