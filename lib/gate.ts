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
}

export type GateReason =
  | 'suspended'
  | 'blocked'
  | 'tutor_complete_profile'
  | 'tutor_apply_no_plan'
  | 'tutor_apply_quota'
  | 'tutor_message'
  | 'tutor_contact'
  | 'tutor_viewer_identity'
  | 'parent_verify'
  | 'parent_hire'
  | 'parent_contact'
  | 'parent_post_quota'

/** Which plan unlocks each reason. null = not something a plan fixes. */
const REQUIRES: Record<GateReason, string | null> = {
  suspended: null,
  blocked: null,
  tutor_complete_profile: null,
  parent_verify: null,
  tutor_apply_no_plan: 'verified',
  tutor_apply_quota: 'premium',
  tutor_message: 'premium',
  tutor_contact: 'featured',
  // PREMIUM, not verified. `plans.can_see_viewer_identity` is true on premium
  // and featured and false on verified -- so a "See who" button that sold the
  // Rs 199 plan would take money for a thing that plan does not do. The
  // wording rule cuts both ways: we sell visibility, and we do not sell a
  // power the row does not carry.
  tutor_viewer_identity: 'premium',
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
export async function buildGate(
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

    case 'tutor_complete_profile':
      return {
        kind: 'complete',
        title: 'Finish your profile first',
        body:
          'Parents only see tutors whose profile is 100% complete, so applying before that ' +
          'would not reach anyone. It costs nothing to finish.',
        audience: 'tutor',
        href: '/tutor/complete-profile',
        ctaLabel: 'Complete my profile',
        actionable: true,
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
          'Premium shows the name and photo of every parent who opens your profile, alongside ' +
          'the subject and area they searched for. It also lets you message any parent directly, ' +
          'without waiting for them to write first.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Premium',
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
