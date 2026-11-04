// lib/onboarding/missingItems.ts
//
// "What's missing" (owner, 13 Oct 2026) — ONE list of what a tutor still has to
// do, in plain English, used by the tutor dashboard, the top of every onboarding
// step, the admin "Stuck in onboarding" list and the WhatsApp follow-up text.
//
// PURE, and it invents no rule: every item is "done" by the SAME test the
// onboarding steps use (lib/tutorFlow stepDone), so the list is empty exactly
// when the flow has nothing left to ask. The one step that covers two things —
// "contact" needs a verified mobile AND a WhatsApp number — is shown as its two
// parts, so the tutor is told which one is left. (scripts/test-missing-items.ts)

import { NEW_FLOW_ORDER, type FlowFacts, type FlowStepKey } from '@/lib/tutorFlow'
import { summariseRequired, tutorRequiredItems, type RequiredItem } from '@/lib/profileRequired'

// Since 4 Nov 2026 the items ARE the shared completion rule (lib/profileRequired):
// the percentage, the stored profile_completion and this list cannot disagree.
export type OnboardingItem = RequiredItem

/** Every onboarding item for this tutor, done or not, in flow order. */
export function onboardingItems(f: FlowFacts): OnboardingItem[] {
  return tutorRequiredItems(f)
}

export type MissingSummary = {
  items: OnboardingItem[]
  missing: OnboardingItem[]
  done: number
  total: number
  /** 0–100, the shared completion percentage (100 only when nothing is missing). */
  percent: number
}

export function missingSummary(f: FlowFacts): MissingSummary {
  return summariseRequired(onboardingItems(f))
}

/** "6 of 16 done". */
export function progressLine(s: Pick<MissingSummary, 'done' | 'total'>): string {
  return `${s.done} of ${s.total} done`
}

/** The page that opens the flow at exactly that step. */
export function fixHref(item: Pick<OnboardingItem, 'step'>): string {
  return `/tutor/complete-profile?step=${item.step}`
}

/** A `?step=` value → the step it means, or null. Older links said "mobile". */
export function stepFromParam(v: string | null | undefined): FlowStepKey | null {
  const k = (v ?? '').trim().toLowerCase()
  if (!k) return null
  if (k === 'mobile' || k === 'phone' || k === 'whatsapp') return 'contact'
  if (k === 'level') return 'subjects'
  return (NEW_FLOW_ORDER as string[]).includes(k) ? (k as FlowStepKey) : null
}

/**
 * The missing items as one sentence for a message to the tutor:
 * "Add your subjects, choose your gender and add your teaching areas." Long
 * lists are cut to the first `max` with "and N more".
 */
export function missingSentence(labels: string[], max = 5): string {
  const list = labels.map((l) => l.trim()).filter(Boolean)
  if (list.length === 0) return ''
  const shown = list.slice(0, max).map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)))
  const more = list.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more.`
  if (shown.length === 1) return `${shown[0]}.`
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}.`
}
