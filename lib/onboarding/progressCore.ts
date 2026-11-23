// lib/onboarding/progressCore.ts — PURE (scripts/test-pr17.ts).
//
// ONE progress number everywhere (PR-17 Part C.4 / E.2, owner 23 Nov 2026):
// "X of 16 steps done". The onboarding dashes, the line above them, the
// dashboard's top card, its "Your next step" card, the Google card and every
// notification read the SAME items — lib/profileRequired tutorRequiredItems
// (16 for a tutor without a selfie; an uploaded optional selfie adds one done
// item). One dash per item, in onboarding order; a done dash is tappable and
// opens that item's step. No separate percentage is shown.

import type { RequiredItem } from '@/lib/profileRequired'
import type { FlowStepKey } from '@/lib/tutorFlow'

export type ProgressDash = {
  key: string
  step: FlowStepKey
  label: string
  done: boolean
  /** The item the tutor is on now. */
  current: boolean
}

/** The step a flow screen belongs to, as items name it: the level screen is
 *  the first half of choosing subjects. */
function itemStep(step: FlowStepKey | 'final' | null): FlowStepKey | null {
  if (!step || step === 'final') return null
  if (step === 'level') return 'subjects'
  return step
}

export function progressDashes(items: readonly RequiredItem[], current: FlowStepKey | 'final' | null): ProgressDash[] {
  const s = itemStep(current)
  // Contact covers two items (mobile, WhatsApp): the current one is the first
  // of them not done yet (else the first).
  const sameStep = items.filter((i) => i.step === s)
  const currentKey = (sameStep.find((i) => !i.done) ?? sameStep[0])?.key ?? null
  return items.map((i) => ({ key: i.key, step: i.step, label: i.button, done: i.done, current: i.key === currentKey }))
}

/** "9 of 16 steps done". */
export function stepsDoneLine(done: number, total: number): string {
  return `${done} of ${total} steps done`
}

export type NextStep = {
  item: RequiredItem
  /** 1-based position of the item in the list ("step X of 16"). */
  position: number
  total: number
}

/** The first item not done, in onboarding order — where every entry opens. */
export function nextItem(items: readonly RequiredItem[]): NextStep | null {
  const i = items.findIndex((x) => !x.done)
  return i < 0 ? null : { item: items[i], position: i + 1, total: items.length }
}

/** Everything but the Verification Fee is done — onboarding is finished. */
export function onboardingItemsDone(items: readonly RequiredItem[]): boolean {
  return items.every((i) => i.done || i.key === 'verify')
}

/** The label a "Continue" button/notification carries until onboarding is
 *  finished: "Continue onboarding (9 of 16)". */
export function continueOnboardingLabel(done: number, total: number): string {
  return `Continue onboarding (${done} of ${total})`
}

/** "Continue: Add your WhatsApp number (step 11 of 16)". */
export function continueStepLabel(n: NextStep): string {
  return `Continue: ${n.item.label} (step ${n.position} of ${n.total})`
}

/** Item keys never shown as a separate "missing" chip on the dashboard: the
 *  tagline and bio are written by AI inside onboarding and complete there
 *  (PR-17 E.7) — they still count as a step. */
export const NOT_A_CHIP: ReadonlySet<string> = new Set(['tagline'])

/** The small chips under the "Your next step" button: the remaining items
 *  after the next one, in onboarding order, without the fee and NOT_A_CHIP. */
export function remainingChips(items: readonly RequiredItem[]): RequiredItem[] {
  const next = nextItem(items)
  return items.filter((i) => !i.done && i.key !== next?.item.key && i.key !== 'verify' && !NOT_A_CHIP.has(i.key))
}

/** Enabled-Next hints (C.5): a short line saying what is missing when Next is
 *  disabled, per step. */
export const NEXT_HINTS: Partial<Record<FlowStepKey | 'mobile' | 'otp' | 'whatsapp', string>> = {
  gender: 'Choose your gender',
  city: 'Choose your city',
  area: 'Choose at least one area',
  level: 'Choose at least one subject',
  subjects: 'Choose at least one subject',
  jobtype: 'Choose at least one type of work',
  fee: 'Enter your monthly fee',
  experience: 'Choose your years of experience',
  degree: 'Add your education',
  availability: 'Pick at least one time slot',
  mobile: 'Enter an 11-digit mobile number',
  otp: 'Enter the 6-digit code we sent you',
  whatsapp: 'Enter an 11-digit WhatsApp number',
  photo: 'Add your photo',
  selfie: 'Take your selfie, or tap Add later',
  cnic_number: 'Enter your 13-digit CNIC number',
  cnic_photos: 'Add both sides of your CNIC',
  tagline: 'Write a tagline and a short bio',
}
