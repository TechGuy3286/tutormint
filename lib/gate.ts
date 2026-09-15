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
import { listingFixes, type ListingBlocker } from '@/lib/tutorListingStatus'

/**
 * The "you are not listed, here is exactly what is missing" gate (owner PR3
 * §1.3): a list of the fixable blockers (mobile, subject, city — and the fee if
 * that is among them), each linking to its fix. PURE and price-free. The caller
 * uses it only when MORE than the fee is missing; a fee-only tutor gets the
 * existing CNIC verify modal (buildGate('tutor_verify')) instead.
 */
export function buildListingGate(blockers: ListingBlocker[]): Gate {
  const missing = listingFixes(blockers)
  return {
    kind: 'verify',
    title: 'You are not shown to parents yet',
    body: 'Add these and you appear in search. Verified tutors are shown to parents first.',
    audience: 'tutor',
    href: missing[0]?.href ?? '/tutor/complete-profile',
    ctaLabel: 'Fix these',
    // The list carries the links; there is no single CTA to press.
    actionable: false,
    missing,
  }
}

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
  /**
   * The "what is missing to be listed" checklist (owner PR3 §1.3): each fixable
   * blocker (fee, mobile, subject, city) with the screen that fixes it. When set,
   * the sheet renders this list instead of a single CTA. Present only on the
   * not-listed apply/message gate; a fee-only case uses the CNIC verify modal.
   */
  missing?: { label: string; href: string }[]
}

export type GateReason =
  | 'suspended'
  | 'blocked'
  | 'tutor_verify'
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
  // The one-time Rs 199 verification fee (owner, 15 Sep 2026). The old 'verified'
  // plan code is now the fee marker — loadPlan('verified') returns the Rs 199
  // price for the sheet. This is a VERIFY gate (kind 'verify'), not a plan
  // upsell: an unverified tutor's way onto the platform is the fee, after which
  // they are on the free Basic tier.
  tutor_verify: 'verified',
  // A Basic tutor over their 10/month applications → Premium (Unlimited).
  tutor_apply_quota: 'premium',
  tutor_message: 'premium',
  // Seeing a parent's contact/WhatsApp is a Premium power (Basic NO,
  // Premium/Featured Yes — owner, 15 Sep 2026).
  tutor_contact: 'premium',
  // "See who viewed you" is a Premium power now (Basic NO, Premium/Featured Yes
  // — owner, 15 Sep 2026). Basic/no-plan tutors get the anonymised teaser and
  // this upsell; it sells Premium, the tier whose row carries the power.
  tutor_viewer_identity: 'premium',
  // CV download is free to all three tutor tiers (Basic included). This gate is
  // only reached by an UNVERIFIED tutor with no plan; loadPlan resolves the
  // Rs 199 fee row so the sheet leads with verification, not a paid plan.
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

    case 'tutor_verify':
      // The Rs 199 one-time verification fee gate (owner, 15 Sep 2026). Bilingual
      // heading and body, consistent with onboarding. The client renders the
      // inline CNIC-upload modal for a tutor 'verify' gate; the exact
      // outcome line below is the ONLY outcome language allowed here — visibility,
      // never a promise of being hired.
      return {
        kind: 'verify',
        title: 'Get verified to apply · اپلائی کرنے کے لیے تصدیق کروائیں',
        body:
          'Upload your CNIC (front and back) to become a verified tutor. Verified tutors are shown ' +
          'to parents first.\n\n' +
          'اپنا شناختی کارڈ (سامنے اور پیچھے) اپلوڈ کریں تاکہ آپ تصدیق شدہ ٹیوٹر بن جائیں۔ ' +
          'تصدیق شدہ ٹیوٹرز والدین کو سب سے پہلے دکھائے جاتے ہیں۔',
        audience: 'tutor',
        plan,
        href: '/tutor/verify',
        ctaLabel: 'Verify',
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
          'the subject and area they searched for — so you know who is looking before you spend ' +
          'an application. Premium also lets you view parent contact details and message them on ' +
          'WhatsApp.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Premium',
        actionable: true,
      }

    case 'cv_download':
      // CV download is free to every tutor tier (Basic included). This is only
      // reached by an unverified tutor with no plan, so it leads with the fee.
      return {
        kind: 'verify',
        title: 'Get verified to download your CV',
        body:
          'Your CV is built from your profile and yours to preview any time. Downloading the ' +
          'print-ready PDF needs a verified profile — upload your CNIC to get verified. ' +
          'Verified tutors are shown to parents first.',
        audience: 'tutor',
        plan,
        href: '/tutor/verify',
        ctaLabel: 'Verify',
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
        title: 'Contact details need Premium',
        body:
          "Premium tutors see a parent's phone and WhatsApp number and can message them there " +
          'directly. Featured adds top placement above every other tutor in search.',
        audience: 'tutor',
        plan,
        href: packagesHref('tutor', required),
        ctaLabel: 'See Premium',
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
