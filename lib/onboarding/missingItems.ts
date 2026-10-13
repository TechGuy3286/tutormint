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

import { NEW_FLOW_ORDER, stepDone, type FlowFacts, type FlowStepKey } from '@/lib/tutorFlow'

export type OnboardingItem = {
  key: string
  /** The onboarding step that fixes it — the "Fix now" link opens this step. */
  step: FlowStepKey
  /** Plain English, as an instruction: "Add your subjects". */
  label: string
  done: boolean
}

const nonblank = (v: string | null | undefined) => !!(v && v.trim())

/** What each step asks for, in flow order. `level` and `subjects` are one
 *  choice; `contact` is shown as its parts; tagline and bio are their own step. */
const LABELS: Partial<Record<FlowStepKey, string>> = {
  gender: 'Choose your gender',
  city: 'Choose your city',
  area: 'Add your teaching areas',
  subjects: 'Add your subjects',
  jobtype: 'Choose the work you want',
  fee: 'Set your monthly fee',
  experience: 'Add your years of experience',
  degree: 'Add your education',
  availability: 'Choose when you can teach',
  photo: 'Add your profile photo',
  selfie: 'Take your selfie',
  cnic_number: 'Enter your CNIC number',
  cnic_photos: 'Add photos of your CNIC',
  tagline: 'Write your tagline and bio',
  verify: 'Pay the Verification Fee',
}

/** Every onboarding item for this tutor, done or not, in flow order. */
export function onboardingItems(f: FlowFacts): OnboardingItem[] {
  const out: OnboardingItem[] = []
  for (const step of NEW_FLOW_ORDER) {
    if (step === 'level') continue // one choice with `subjects`
    if (step === 'contact') {
      out.push({ key: 'mobile', step, label: 'Verify your mobile number', done: f.phoneVerified })
      out.push({ key: 'whatsapp', step, label: 'Add your WhatsApp number', done: nonblank(f.whatsapp) })
      continue
    }
    const label = LABELS[step]
    if (!label) continue
    out.push({ key: step, step, label, done: stepDone(f, step) })
  }
  return out
}

export type MissingSummary = {
  items: OnboardingItem[]
  missing: OnboardingItem[]
  done: number
  total: number
  /** 0–100, for the progress bar. */
  percent: number
}

export function missingSummary(f: FlowFacts): MissingSummary {
  const items = onboardingItems(f)
  const missing = items.filter((i) => !i.done)
  const done = items.length - missing.length
  return { items, missing, done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 100 }
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
