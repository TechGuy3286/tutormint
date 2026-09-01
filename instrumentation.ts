// instrumentation.ts
//
// Runs once per server instance, before the first request is served.
//
// This is where configuration that must not be wrong in production is checked.
// The distinction being drawn: a missing optional credential is a degraded
// feature and gets a log line; a setting that would weaken authentication is a
// refusal to start.
//
// A crash on deploy is loud, immediate and attributable. A warning in a log is
// read after the incident it would have prevented.

export async function register() {
  // Only the Node.js runtime -- the edge runtime instance has no business
  // asserting on secrets it was never given.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertOtpSafety } = await import('@/lib/sms')
  const { isDeployed, describeEnv } = await import('@/lib/env')

  // Throws if DEV_DEFAULT_OTP is set on the LIVE SITE. A preview deployment is
  // allowed to carry it -- see lib/env.ts for why NODE_ENV is the wrong
  // question on Vercel.
  assertOtpSafety()

  // Warnings fire on ANY deployment, preview included: a preview with no Resend
  // key should say so rather than leave a tester wondering where the email
  // went. isProduction() would stay quiet there.
  if (!isDeployed()) return

  console.info(`[startup] ${describeEnv()}`)

  // Everything below is a warning, not a refusal: each one degrades a feature
  // rather than opening a hole, and refusing to boot the whole site because
  // nobody has bought an SMS bundle yet would be the wrong trade.
  const optional: [string, string][] = [
    ['SUPABASE_SERVICE_ROLE_KEY', 'admin screens, activation and moderation cannot write'],
    ['RESEND_API_KEY', 'no email will be sent'],
    ['CRON_SECRET', 'the subscription sweep endpoint is unprotected'],
    ['TWILIO_ACCOUNT_SID', 'phone OTP codes cannot be delivered'],
  ]

  const missing = optional.filter(([k]) => !process.env[k])
  for (const [key, effect] of missing) {
    console.warn(`[startup] ${key} is not set — ${effect}`)
  }
  if (missing.length === 0) console.info('[startup] configuration complete')
}
