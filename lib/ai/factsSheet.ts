// lib/ai/factsSheet.ts
//
// THE TUTORMINT FACTS SHEET (owner, 7 Oct 2026). One source for what a blog post
// may say about how TutorMint works — the writer is given it, the checker
// compares every claim against it, and the editor shows it read-only as "Facts
// the writer uses". It is BUILT AT REQUEST TIME from the live plan rows (lib/ai/
// factsSheetServer loads them), so a change to a plan's rights changes the sheet,
// the prompt and the checker together.
//
// Why this exists: the published post "How to become a home tutor in Pakistan"
// said the Verified badge needs a degree certificate and an intro video, called
// the fee a "verification fee" and ended its meta description with the site
// tagline. The old hard-coded facts text said the same wrong things, so the
// writer was faithfully repeating them.
//
// PURE — no imports beyond the fee label — so the editor (client), the routes and
// the tests all read the same sheet.

import { FEE_LABEL } from '@/lib/display'

export type FactsPlan = {
  code: string
  audience: 'tutor' | 'parent'
  name: string
  active: boolean
  canInitiateMessage: boolean
  canViewContact: boolean
  canHire: boolean
  canWhatsapp: boolean
  canSeeViewer: boolean
  searchRank: number
  monthlyQuota: number
  /** What the plans page shows for the monthly allowance ("10", "100", "Unlimited"). */
  displayedQuota: string
}

export type PlatformFacts = {
  feeLabel: string
  /** Active tutor plans, highest search rank first. */
  tutorPlans: FactsPlan[]
  /** Active parent plans, highest search rank first. */
  parentPlans: FactsPlan[]
  /** Tutor plan names that may START a conversation with a parent. */
  tutorInitiators: string[]
  /** Tutor plan names that may see a parent's phone / WhatsApp. */
  tutorContactViewers: string[]
  /** The search order, as words: ["Featured", "Premium", "Verified", "everyone else"]. */
  searchOrder: string[]
}

/** The live plan rows as of 7 Oct 2026 — a fallback when the database cannot be
 *  read, and the fixture the tests use. The live rows always win at run time. */
export const DEFAULT_PLANS: FactsPlan[] = [
  { code: 'featured', audience: 'tutor', name: 'Featured', active: true, canInitiateMessage: true, canViewContact: true, canHire: false, canWhatsapp: true, canSeeViewer: true, searchRank: 3, monthlyQuota: 300, displayedQuota: 'Unlimited' },
  { code: 'premium', audience: 'tutor', name: 'Premium', active: true, canInitiateMessage: true, canViewContact: true, canHire: false, canWhatsapp: true, canSeeViewer: true, searchRank: 2, monthlyQuota: 100, displayedQuota: '100' },
  { code: 'basic', audience: 'tutor', name: 'Basic', active: true, canInitiateMessage: true, canViewContact: false, canHire: false, canWhatsapp: false, canSeeViewer: false, searchRank: 1, monthlyQuota: 10, displayedQuota: '10' },
  { code: 'parent_featured', audience: 'parent', name: 'Featured', active: true, canInitiateMessage: true, canViewContact: true, canHire: true, canWhatsapp: true, canSeeViewer: false, searchRank: 3, monthlyQuota: 100, displayedQuota: 'Unlimited' },
  { code: 'parent_verified', audience: 'parent', name: 'Verified', active: true, canInitiateMessage: true, canViewContact: false, canHire: false, canWhatsapp: false, canSeeViewer: false, searchRank: 1, monthlyQuota: 5, displayedQuota: '5' },
]

const byRank = (a: FactsPlan, b: FactsPlan) => b.searchRank - a.searchRank || a.name.localeCompare(b.name)

/** The structured facts, from plan rows (inactive rows — the old fee marker — are ignored). */
export function buildPlatformFacts(plans: FactsPlan[] = DEFAULT_PLANS): PlatformFacts {
  const live = plans.filter((p) => p.active)
  const tutorPlans = live.filter((p) => p.audience === 'tutor').sort(byRank)
  const parentPlans = live.filter((p) => p.audience === 'parent').sort(byRank)
  const lowest = tutorPlans.length ? Math.min(...tutorPlans.map((p) => p.searchRank)) : 0
  // Plans that rank above the base tier, in order; then a fee-paid tutor on the
  // base plan (who carries the Verified badge); then everyone else.
  const searchOrder = [...tutorPlans.filter((p) => p.searchRank > lowest).map((p) => p.name), 'Verified', 'everyone else']
  return {
    feeLabel: FEE_LABEL,
    tutorPlans,
    parentPlans,
    tutorInitiators: tutorPlans.filter((p) => p.canInitiateMessage).map((p) => p.name),
    tutorContactViewers: tutorPlans.filter((p) => p.canViewContact).map((p) => p.name),
    searchOrder,
  }
}

/** "Featured unlimited, Premium 100, Basic 10" — the page's own allowance words. */
function allowances(plans: FactsPlan[]): string {
  return plans
    .map((p) => `${p.name} ${p.displayedQuota.toLowerCase() === 'unlimited' ? 'unlimited' : p.displayedQuota || String(p.monthlyQuota)}`)
    .join(', ')
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The facts sheet as plain text — what the writer is given and the editor shows. */
export function factsSheetText(facts: PlatformFacts = buildPlatformFacts()): string {
  const fee = facts.feeLabel
  const planNames = facts.tutorPlans.map((p) => p.name)
  const initiators = facts.tutorInitiators
  const allInitiate = initiators.length === planNames.length && planNames.length > 0
  return [
    'TUTORMINT FACTS — state only these about how TutorMint works, and never contradict them.',
    '- Signing up is free for tutors and for parents.',
    '- A tutor appears in Browse once their mobile number is verified and their city, area, subjects and gender are set.',
    `- The one-time fee is ALWAYS called the "${fee}". Never call it a "verification fee" or any other name. Never write any amount or price anywhere in a post.`,
    `- The Verified badge comes from the ${fee} plus submitting a CNIC, a profile photo and a selfie. A degree, certificates and an introduction video are OPTIONAL and are not needed for any badge.`,
    "- A tutor's experience, subjects and fee are self-declared. TutorMint does not check them.",
    `- Tutor plans: ${list(planNames)}. Name them, never price them.`,
    `- Who can apply to tuitions: tutors who have paid the ${fee}, on any plan (${list(planNames)}). A tutor who has not paid it cannot apply.`,
    `- Who can reply to a parent: tutors who have paid the ${fee}.`,
    allInitiate
      ? `- Messaging: every verified tutor, Basic included, can message parents in the app — start a conversation or reply. (${list(planNames)} all can.)`
      : `- Who can start a conversation with a parent: ${list(initiators)} tutors only. Other tutors can reply when a parent writes first.`,
    `- Monthly allowances (from the plans page; describe them in words in a post, e.g. "a monthly allowance", never as a price): applications — ${allowances(facts.tutorPlans)}. Viewing a tuition's contact number uses one application. Seeing a parent's phone number and email — ${allowances(facts.tutorPlans)}. Incoming hiring and demo requests — ${allowances(facts.tutorPlans)}.`,
    facts.tutorPlans.some((p) => p.canWhatsapp)
      ? `- WhatsApp parents with one tap: ${list(facts.tutorPlans.filter((p) => p.canWhatsapp).map((p) => p.name))} tutors.`
      : '',
    facts.tutorPlans.some((p) => p.canSeeViewer)
      ? `- See who viewed your profile: ${list(facts.tutorPlans.filter((p) => p.canSeeViewer).map((p) => p.name))} tutors.`
      : '',
    `- Matched tuitions by email: ${list(facts.tutorPlans.filter((p) => p.canViewContact).map((p) => p.name))} tutors; by WhatsApp: ${list(facts.tutorPlans.filter((p) => p.searchRank >= 3).map((p) => p.name))} tutors.`,
    `- Search order: ${facts.searchOrder.join(', then ')}.`,
    '- A parent needs only a verified mobile number (free) to post a tuition, message a tutor or request a demo. CNIC and home address are optional; once both are approved the parent gets the green Verified badge.',
    `- Parent plans: ${facts.parentPlans
      .map((p) => {
        const powers = [
          p.canInitiateMessage ? 'message any tutor' : '',
          `post ${p.displayedQuota.toLowerCase() === 'unlimited' ? 'unlimited' : 'a few'} tuitions a month`,
          p.canViewContact ? 'see tutor phone and WhatsApp' : '',
          p.canWhatsapp ? 'WhatsApp tutors with one tap' : '',
          p.canHire ? 'complete a hire' : '',
        ].filter(Boolean)
        return `${p.name} — ${powers.join(', ')}`
      })
      .join('; ')}. Only a Featured parent can complete a hire.`,
    '- TutorMint takes no commission. It never promises tuitions, replies, applications, hires or income — only visibility.',
    `- Payments are not refundable: the ${fee} and plans carry no refund.`,
    '- A demo is a demo lesson. Never call it free.',
  ]
    .filter(Boolean)
    .join('\n')
}
