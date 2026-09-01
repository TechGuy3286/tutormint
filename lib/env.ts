// lib/env.ts
//
// Which environment is this, for the purpose of dev-only switches.
//
// THE PROBLEM THIS SOLVES. A Vercel preview deployment is built with
// `next build`, so NODE_ENV is 'production' there — identically to the live
// site. Anything gated on NODE_ENV therefore switches OFF on preview: the
// payment simulator refuses, the OTP bypass returns null, /dev/components 404s.
// That is correct for tutormint.org and wrong for a branch somebody is trying
// to test, because the alternative is handing a tester a real card gateway and
// an SMS bill.
//
// So the question "is this the live site" is asked of VERCEL_ENV, which Vercel
// sets to 'production' | 'preview' | 'development' per deployment, and NODE_ENV
// is the fallback for a local build where VERCEL_ENV does not exist.
//
// WHAT THIS DOES AND DOES NOT RELAX. It governs test conveniences only:
//
//   relaxed on preview   DEV_DEFAULT_OTP, the payment simulator, /dev/*,
//                        the console SMS and email adapters, seed scripts
//   NOT relaxed, ever    row-level security, authentication, entitlements,
//                        rate limits, security headers, the CSP, admin
//                        permissions, re-authentication
//
// A preview deployment points at the same Supabase project with the same
// policies. Nothing here can loosen a database rule, because nothing here is
// consulted by one.
//
// SERVER ONLY. VERCEL_ENV carries no NEXT_PUBLIC_ prefix, so it is undefined in
// a browser bundle and `isProduction` would silently read false there. Every
// caller in this repo is a server component, a route handler, instrumentation
// or a script. Do not import this from a client component; if a client ever
// needs to know, pass the answer down as a prop from a server component.

/** Vercel's own name for the deployment, when there is one. */
export type DeploymentEnv = 'production' | 'preview' | 'development' | 'local'

export function deploymentEnv(): DeploymentEnv {
  const v = process.env.VERCEL_ENV
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return 'local'
}

/**
 * The live site, and only the live site.
 *
 * Locally (no VERCEL_ENV) this falls back to NODE_ENV, so `next build &&
 * next start` on a laptop still behaves like production — which is what makes
 * the production checks in PRODUCTION_CHECKLIST.md testable without deploying.
 */
export function isProduction(): boolean {
  const v = process.env.VERCEL_ENV
  if (v) return v === 'production'
  return process.env.NODE_ENV === 'production'
}

/** A Vercel preview deployment: a real build of a branch, for testing. */
export function isPreview(): boolean {
  return process.env.VERCEL_ENV === 'preview'
}

/**
 * Deployed anywhere at all, preview included.
 *
 * Used for startup warnings about missing credentials: a preview with no
 * RESEND_API_KEY should still say so, and `isProduction()` would stay quiet.
 */
export function isDeployed(): boolean {
  return Boolean(process.env.VERCEL_ENV) || process.env.NODE_ENV === 'production'
}

/** For log lines and the startup banner. */
export function describeEnv(): string {
  const v = process.env.VERCEL_ENV
  return v ? `VERCEL_ENV=${v}` : `local (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`
}
