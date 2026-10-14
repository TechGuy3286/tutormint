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

  const { assertOtpSafety, smsProviderLabel } = await import('@/lib/sms')
  const { missingSendpkEnv } = await import('@/lib/sms/sendpk')
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

  // The selected SMS/OTP provider, by NAME only (owner PR5b §1.2) — so the
  // delivery path is stated in the boot log and can be read back after a deploy.
  const smsProvider = smsProviderLabel()
  console.info(`[startup] SMS provider: ${smsProvider}`)

  // SendPK is the only SMS provider (owner, 14 Oct 2026). Warn only when one of
  // its four settings is missing, and name SendPK and the missing settings —
  // nothing else, so the line points diagnosis the right way.
  const sendpkMissing = missingSendpkEnv()
  if (sendpkMissing.length > 0) {
    console.warn(`[startup] SendPK is not fully configured (missing: ${sendpkMissing.join(', ')}) — phone and password-reset codes cannot be sent by SMS`)
  }

  // Everything below is a warning, not a refusal: each one degrades a feature
  // rather than opening a hole, so a missing one is named.
  const optional: [string, string][] = [
    ['SUPABASE_SERVICE_ROLE_KEY', 'admin screens, activation and moderation cannot write'],
    ['RESEND_API_KEY', 'no email will be sent'],
    ['CRON_SECRET', 'the subscription sweep endpoint is unprotected'],
  ]

  const missing = optional.filter(([k]) => !process.env[k])
  for (const [key, effect] of missing) {
    console.warn(`[startup] ${key} is not set — ${effect}`)
  }
  if (missing.length === 0) console.info('[startup] configuration complete')
}
