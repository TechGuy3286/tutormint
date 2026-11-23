// PURE (scripts/test-pr17.ts). The parent hire allowance (PR-17 Part D, owner 23 Nov 2026).
//
//   * A free (Verified) parent may hire 5 tutors in total, EVER — a lifetime
//     allowance, not a monthly one. The 6th hire is refused with
//     HIRE_LIMIT_MESSAGE and a link to Membership Plans.
//   * A Featured parent is shown "Unlimited hires"; a real cap stays hidden
//     behind it (as other "Unlimited" limits do) — FEATURED_HIRE_CAP, counted
//     over the same lifetime total. Admin sees the real numbers.
//   * A hire = one of the parent's tuitions completed with a hired tutor
//     (jobs.hired_at set by the parent's Hire action, lib/jobs hireApplicant).
//     A staff "Hired" stage on an application never counts (it never changes
//     the tuition).
// The server enforces it (hireApplicant + /api/gate); the page only mirrors it.

export const FREE_PARENT_HIRE_LIMIT = 5
/** Hidden behind "Unlimited hires" on Featured. */
export const FEATURED_HIRE_CAP = 100

export const HIRE_LIMIT_MESSAGE = `You've used your ${FREE_PARENT_HIRE_LIMIT} hires. Upgrade to Featured to hire more.`
/** Featured at its hidden cap — no upgrade exists above it. */
export const HIRE_CAP_MESSAGE = 'You have reached the hiring limit on your account. Message us on WhatsApp and we will help.'

/** The Membership Plans card lines (D.2). */
export const FREE_HIRE_LINE = `Hire ${FREE_PARENT_HIRE_LIMIT} tutors`
export const FEATURED_HIRE_LINE = 'Unlimited hires'

export type HireAllowance = {
  allowed: boolean
  used: number
  /** The real limit (admin view). */
  limit: number
  /** What the member is shown: a number, or 'unlimited'. */
  shown: number | 'unlimited'
  remaining: number
  /** Refused because the free allowance is used — the upgrade path applies. */
  needsUpgrade: boolean
}

export function hireAllowance(input: { featured: boolean; used: number }): HireAllowance {
  const used = Math.max(0, Math.floor(Number(input.used) || 0))
  const limit = input.featured ? FEATURED_HIRE_CAP : FREE_PARENT_HIRE_LIMIT
  const allowed = used < limit
  return {
    allowed,
    used,
    limit,
    shown: input.featured ? 'unlimited' : FREE_PARENT_HIRE_LIMIT,
    remaining: Math.max(0, limit - used),
    needsUpgrade: !allowed && !input.featured,
  }
}
