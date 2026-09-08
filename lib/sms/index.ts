// lib/sms/index.ts
//
// Provider selection, and the one rule that matters most in this directory.
//
// SELECTION: twilio when its credentials are present, otherwise the console
// adapter in development, otherwise a provider that reports failure. There is
// no "pretend it worked" branch in production. A member told "code sent" who
// never receives one has no way to tell that from a slow network, and will sit
// on that screen indefinitely.
//
// THE DEV BYPASS. DEV_DEFAULT_OTP lets a fixed code verify any number, so a
// developer can create ten test accounts without a carrier bill. In production
// it is a master key to every account on the platform: know the code, claim any
// phone number, pass verification as anybody.
//
// So it is guarded three times over, on the principle that the check which
// matters is the one that survives someone refactoring the other two:
//
//   1. devOtpCode() returns null on the live site, whatever the variable says.
//      This is the check that actually protects the flow.
//   2. assertOtpSafety() throws at server startup (instrumentation.ts) if the
//      variable is set on the live site at all — a loud crash on deploy, not a
//      silent one-line log nobody reads, because a variable set in production
//      means someone believed it would work.
//   3. The OTP route calls devOtpCode() rather than reading process.env, so
//      there is exactly one place in the codebase that touches the variable.
//
// "The live site" is isProduction() from lib/env.ts, NOT NODE_ENV. A Vercel
// preview is built with `next build`, so NODE_ENV is 'production' there too,
// and gating on it would take the bypass away from the one environment that
// most needs it: a branch somebody is testing, with no SMS provider attached
// and no wish to be billed per code. VERCEL_ENV distinguishes them; on
// tutormint.org it reads 'production' and nothing below changes.

import type { SmsProvider, SmsResult } from './provider'
import { twilioProvider } from './twilio'
import { consoleProvider } from './console'
import { isProduction, describeEnv } from '@/lib/env'

export type { SmsProvider, SmsResult } from './provider'

const unconfigured: SmsProvider = {
  name: 'none',
  isConfigured: () => false,
  async send(): Promise<SmsResult> {
    return {
      ok: false,
      provider: 'none',
      error: 'No SMS provider is configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.',
    }
  },
}

export function getSmsProvider(): SmsProvider {
  if (twilioProvider.isConfigured()) return twilioProvider
  if (!isProduction()) return consoleProvider
  return unconfigured
}

/**
 * The development OTP bypass code, or null.
 *
 * The ONLY place in the codebase that reads DEV_DEFAULT_OTP. Returns null in
 * production regardless of the environment, so the bypass branch in the OTP
 * route is unreachable there even if the variable is set on the deployment.
 */
export function devOtpCode(): string | null {
  if (isProduction()) return null
  const v = process.env.DEV_DEFAULT_OTP
  return v && v.trim() ? v.trim() : null
}

/**
 * The BRIDGE OTP code, or null.
 *
 * DELIBERATELY ALLOWED IN PRODUCTION, and deliberately a DIFFERENT variable
 * from DEV_DEFAULT_OTP (owner, Sunday 6 Sep). Until the owner's third-party OTP
 * API is enabled there is no way to deliver a real code on the live site, and a
 * signup that creates an account nobody can verify is worse than a shared bridge
 * code the owner controls and hands out. So `BRIDGE_OTP` verifies any signup —
 * but every account it verifies is TAGGED `phone_verified_via='bridge'`, is
 * visible as such in admin and the CSV export, and is made to re-verify once
 * when the bridge is removed (see the login route). This is the whole reason it
 * is separate from DEV_DEFAULT_OTP: that one is a test convenience that must
 * NEVER reach production (assertOtpSafety throws on it), and this one is an
 * owner-operated stopgap that lives ON production until a real provider lands.
 *
 * assertOtpSafety() below inspects only DEV_DEFAULT_OTP, so this does not trip
 * the production boot guard.
 */
export function bridgeOtpCode(): string | null {
  const v = process.env.BRIDGE_OTP
  return v && v.trim() ? v.trim() : null
}

/**
 * Startup assertion. Called from instrumentation.ts, which Next runs once per
 * server instance before it serves a request.
 *
 * Throwing is the point. A warning in a log is not a control -- production logs
 * are read after an incident, not before one -- and a production deployment
 * carrying DEV_DEFAULT_OTP is not a configuration wrinkle to note, it is an
 * authentication bypass someone has switched on believing it does something.
 * Better to fail the boot and have somebody remove it.
 */
export function assertOtpSafety(): void {
  if (!isProduction()) return

  if (process.env.DEV_DEFAULT_OTP && process.env.DEV_DEFAULT_OTP.trim()) {
    throw new Error(
      `DEV_DEFAULT_OTP is set on the live site (${describeEnv()}). That variable makes ` +
        'a fixed code verify any phone number, which in production is a master key to ' +
        'every account. It is ignored by the code, but its presence means someone ' +
        'expects it to work. Remove it from the Production environment and redeploy. ' +
        'It is fine, and expected, on a Preview deployment.',
    )
  }
}
