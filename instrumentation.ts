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

  // Warn about SMS ONLY when NO provider at all is configured — never name a
  // specific unconfigured fallback (owner PR28 §2.2/§2.3). "TWILIO_ACCOUNT_SID
  // is not set" was logged on every request even though SendPK is the live
  // provider and codes deliver fine: a wrong, noisy line. getSmsProvider()
  // picks whatever IS configured (SendPK, then Twilio), so the only real fault
  // is when it falls through to 'unconfigured'.
  if (smsProvider === 'unconfigured') {
    console.warn('[startup] no SMS provider is configured — phone OTP codes cannot be delivered')
  }

  // Everything below is a warning, not a refusal: each one degrades a feature
  // rather than opening a hole. These have no alternative provider — a missing
  // one is genuinely a degraded feature, so it is named. (An unconfigured SMS
  // FALLBACK is not, per above.)
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
