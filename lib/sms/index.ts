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
//   1. devOtpCode() returns null when NODE_ENV === 'production', whatever the
//      variable says. This is the check that actually protects the flow.
//   2. assertOtpSafety() throws at server startup (instrumentation.ts) if the
//      variable is set in a production build at all — a loud crash on deploy,
//      not a silent one-line log nobody reads, because a variable set in
//      production means someone believed it would work.
//   3. The OTP route calls devOtpCode() rather than reading process.env, so
//      there is exactly one place in the codebase that touches the variable.

import type { SmsProvider, SmsResult } from './provider'
import { twilioProvider } from './twilio'
import { consoleProvider } from './console'

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
  if (process.env.NODE_ENV !== 'production') return consoleProvider
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
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env.DEV_DEFAULT_OTP
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
  if (process.env.NODE_ENV !== 'production') return

  if (process.env.DEV_DEFAULT_OTP && process.env.DEV_DEFAULT_OTP.trim()) {
    throw new Error(
      'DEV_DEFAULT_OTP is set in a production build. That variable makes a fixed ' +
        'code verify any phone number, which in production is a master key to every ' +
        'account. It is ignored by the code, but its presence means someone expects ' +
        'it to work. Remove it from the deployment environment and redeploy.',
    )
  }
}
