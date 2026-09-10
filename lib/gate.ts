// lib/gate.ts
//
// One shape for "you cannot do that yet", so every gated action answers the
// same way and the client can render one sheet instead of a different toast
// per route.
//
// WHY THE PRICE COMES FROM HERE, ON THE SERVER, IN THE 403
//
// CLAUDE.md's conversion rules make the price conditional on the member having
// reached for something: "never signal 'paid platform' to anyone who has not
// signed up or has not chosen to open a packages page". If the client held a
// price list so it could render a sheet, the price would exist in the page
// before any gated action -- one `view-source` from being a paywall hint on a
// public browse page. Sending it only in the 403 means the price is created by
// the attempt, which is exactly the rule.
//
// It is also why `buildGate` reads `plans` rather than taking a number: rule 7
// forbids hardcoded pricing, and the packages pages already read the same rows.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { Entitlements } from '@/lib/entitlements'
import { packagesHref, type Audience } from '@/lib/upgradePath'

/**
 * Why an action was refused.
 *
 * `suspended` is deliberately first and separate. A suspended member is not a
 * sales opportunity: showing them a price implies buying something would fix
 * it, and nothing they can buy will. `getEntitlements()` short-circuits on
 * suspension, and every gate site checks it before any tier or quota test.
 */
export type GateKind =
  | 'suspended'
  | 'upgrade'
  | 'quota'
  | 'verify'
  | 'complete'
  | 'blocked'

export type GatePlan = {
  code: string
  name: string
  pricePkr: number
  /** "10", "25", "Unlimited" — the marketing figure, as the packages page shows it. */
  displayedQuota: string | null
}

/** Everything the sheet needs. Plain data: it crosses the wire as JSON. */
export type Gate = {
  kind: GateKind
  /** Heading, in the member's terms. */
  title: string
  /** What the action needs, in plain words. One or two sentences. */
  body: string
  audience: Audience | null
  /** Absent for suspended, verify, complete and blocked — those cost nothing. */
  plan?: GatePlan
  /** Where the single tap goes. */
  href: string
  ctaLabel: string
  /** When false the sheet shows no action button, only a dismiss. */
  actionable: boolean
  /**
   * A second, lower-emphasis action. Present only for a tutor under 100%: the
   * primary becomes "Finish profile first" and this carries "Buy anyway", so
   * buying is never hard-blocked but finishing is the steered path.
   */
  secondary?: { label: string; href: string }
}

export type GateReason =
  | 'suspended'
  | 'blocked'
  | 'tutor_apply_no_plan'
  | 'tutor_apply_quota'
  | 'tutor_message'
  | 'tutor_contact'
  | 'tutor_viewer_identity'
  | 'cv_download'
  | 'parent_verify'
  | 'parent_hire'
  | 'parent_contact'
  | 'parent_post_quota'

/** Which plan unlocks each reason. null = not something a plan fixes. */
const REQUIRES: Record<GateReason, string | null> = {
  suspended: null,
  blocked: null,
  parent_verify: null,
  tutor_apply_no_plan: 'verified',
  tutor_apply_quota: 'premium',
  tutor_message: 'premium',
  tutor_contact: 'featured',
  // VERIFIED (199) and above (owner, 8 Sep 2026; migration 57 sets
  // can_see_viewer_identity = true on verified again, restoring the migration-43
  // decision). Seeing the parent's NAME is the primary 199-funnel reward, so the
  // profile-view teaser sells Verified, not Premium. Only free/no-plan tutors get
  // the anonymised teaser and this upsell. Same rule as always -- a button never
  // sells a power its plan does not carry -- so the row (migration 57) moved
  // before this label. This supersedes the migration-56 flip to 'premium'.
  tutor_viewer_identity: 'verified',
  // Downloading the print-ready CV built from the profile. Verified (199) and
  // above; the preview is free to everyone, only the download is gated.
  cv_download: 'verified',
  parent_hire: 'parent_featured',
  parent_contact: 'parent_featured',
  parent_post_quota: 'parent_featured',
}

async function loadPlan(code: string): Promise<GatePlan | undefined> {
  const db = createAdminClient() ?? (await createClient())
  const { data } = await db
    .from('plans')
    .select('code, name, price_pkr, displayed_quota')
    .eq('code', code)
    .maybeSingle()
  if (!data) return undefined
  return {
    code: data.code as string,
    name: data.name as string,
    pricePkr: Number(data.price_pkr ?? 0),
    displayedQuota: (data.displayed_quota as string | null) ?? null,
  }
}

/**
 * Build the sheet payload for a refusal.
 *
 * `ent` is optional so a caller that has already established the member cannot
 * do the thing (a blocked pair, say) does not have to load entitlements again.
 */
/**
 * The public builder. Since 10 Sep 2026 completion no longer gates listing, so
 * this is just the base gate — there is no under-100% "finish first" override
 * any more (a paid tutor at 40% is listed and applying). Kept as the public
 * entry point so callers do not depend on buildBaseGate directly.
 */
export async function buildGate(
  reason: GateReason,
  ent?: Pick<Entitlements, 'audience' | 'plan' | 'quota' | 'profileCompletion'> | null,
): Promise<Gate> {
  // Completion no longer gates listing (owner, 10 Sep 2026), so a gate no longer
  // leads with "finish your profile first / buy anyway": a paid tutor at 40% is
  // listed and applying, and the honest upsell is the plan itself. The base gate
  // stands on its own.
  return buildBaseGate(reason, ent)
}

async function buildBaseGate(
  reason: GateReason,
  ent?: Pick<Entitlements, 'audience' | 'plan' | 'quota'> | null,
): Promise<Gate> {
  const audience: Audience | null = ent?.audience ?? defaultAudience(reason)
  const required = REQUIRES[reason]
  const plan = required ? await loadPlan(required) : undefined

  switch (reason) {
    case 'suspended':
      return {
        kind: 'suspended',
        title: 'Your account is suspended',
        body:
          'While an account is suspended you cannot apply, message, hire or see contact ' +
          'details. Nothing has been deleted, and support can tell you why and what happens next.',
        audience,
        href: '/support',
        ctaLabel: 'Contact support',
        actionable: true,
      }

    case 'blocked':
      return {
        kind: 'blocked',
        title: 'You cannot contact this member',
        body: 'One of you has blocked the other, so messages and applications between you are closed.',
        audience,
        href: '/support',
        ctaLabel: 'Contact support',
        actionable: false,
      }

    case 'parent_verify':
      return {
        kind: 'verify',
        title: 'Verify your identity first',
        body:
          'Posting a job and messaging tutors need your CNIC and address approved. It is free, ' +
          'and it is what earns the Verified badge tutors look for.',
        audience: 'parent',
        href: '/parent/verify',
        ctaLabel: 'Start verification',
        actionable: true,
      }

    case 'tutor_apply_no_plan':
      return {
        kind: 'upgrade',
        title: 'Applying needs an active plan',
        body: `Verified tutors can apply to ${plan?.displayedQuota ?? 'a set number of'} jobs a month and carry the Verified badge on every card and search result.`,
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See the Verified plan',
        actionable: true,
      }

    case 'tutor_apply_quota':
      return {
        kind: 'quota',
        title: "You have used this month's applications",
        body: `Your allowance resets at the start of next month. Premium raises it to ${plan?.displayedQuota ?? 'more'} a month and lets you message parents directly.`,
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Premium',
        actionable: true,
      }

    case 'tutor_viewer_identity':
      return {
        kind: 'upgrade',
        title: 'See who is looking at you',
        body:
          'Verified shows the name and photo of every parent who opens your profile, alongside ' +
          'the subject and area they searched for — so you know who is looking before you spend ' +
          'an application. Verified also lists you in search and gives you the badge parents look ' +
          'for.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Verified',
        actionable: true,
      }

    case 'cv_download':
      return {
        kind: 'upgrade',
        title: 'Download your CV with Verified',
        body:
          'Your CV is built from your profile and yours to preview any time. Verified unlocks the ' +
          'print-ready PDF — with your verified badge — to send to parents and print at any shop. ' +
          'It also puts you above free tutors in search.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Verified',
        actionable: true,
      }

    case 'tutor_message':
      return {
        kind: 'upgrade',
        title: 'Starting a conversation needs Premium',
        body:
          'Your plan lets you reply to parents who message you and apply for jobs. Premium lets ' +
          'you start the conversation yourself, with any parent.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Premium',
        actionable: true,
      }

    case 'tutor_contact':
      return {
        kind: 'upgrade',
        title: 'Contact details need Featured',
        body:
          "Featured tutors see a parent's phone and WhatsApp number and can message them there " +
          'directly, and appear above every other tutor in search.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Featured',
        actionable: true,
      }

    case 'parent_hire':
      return {
        kind: 'upgrade',
        title: 'Completing a hire needs Featured',
        body:
          'Browsing, messaging tutors and requesting demos stay free. Marking a tutor hired, and ' +
          'seeing their phone and WhatsApp number, is what Featured adds.',
        audience: 'parent',
        plan,
        href: packagesHref('parent', required),
        ctaLabel: 'See Featured',
        actionable: true,
      }

    case 'parent_contact':
      return {
        kind: 'upgrade',
        title: 'Contact details need Featured',
        body:
          "Featured parents see a tutor's phone and WhatsApp number, can open WhatsApp with an " +
          'introduction already written, and sit at the top of tutors’ job lists.',
        audience: 'parent',
        plan,
        href: packagesHref('parent', required),
        ctaLabel: 'See Featured',
        actionable: true,
      }

    case 'parent_post_quota':
      return {
        kind: 'quota',
        title: "You have used this month's job posts",
        body: `Your allowance resets at the start of next month. Featured raises it to ${plan?.displayedQuota ?? 'more'} and adds hiring and contact details.`,
        audience: 'parent',
        plan,
        href: packagesHref('parent', required),
        ctaLabel: 'See Featured',
        actionable: true,
      }
  }
}

function defaultAudience(reason: GateReason): Audience | null {
  if (reason.startsWith('tutor_')) return 'tutor'
  if (reason.startsWith('parent_')) return 'parent'
  return null
}
