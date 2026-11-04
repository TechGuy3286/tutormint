// lib/profileRequired.ts
//
// THE ONE profile-completion rule (owner, 4 Nov 2026). Every percentage a
// member or staff member sees — the dashboard ring and line, Edit Profile's
// step counts, the stored profiles.profile_completion that admin People, the
// member page, Follow-ups, Paid tutors and the Overview read, and the "what's
// missing" text in follow-up messages — comes from the lists here.
//
// The rule: completion counts only the REQUIRED profile items. Email and the
// intro video never count, for tutors or parents. A tutor's items are the
// things the onboarding flow asks for (the same "done" tests as the steps —
// lib/tutorFlow stepDone), so the list is empty exactly when the flow has
// nothing left to ask. Completion never waits on a staff decision: a CNIC or
// selfie counts once it is uploaded, not once it is approved.
//
// PURE — no I/O. (scripts/test-profile-required.ts)

import { stepDone, type FlowFacts, type FlowStepKey } from './tutorFlow'

/** The Edit Profile card that fixes an item (tutor Edit Profile card keys). */
export type TutorCardKey =
  | 'mobile' | 'cnic' | 'profilePic' | 'selfie' | 'subjects' | 'location'
  | 'about' | 'jobType' | 'availability' | 'degrees' | 'experience' | 'monthlyFee' | 'details'

export type RequiredItem = {
  key: string
  /** The onboarding step that fixes it. */
  step: FlowStepKey
  /** As an instruction: "Add your availability". */
  label: string
  /** The button text: "Availability". */
  button: string
  /** The Edit Profile card that fixes it — null when Edit Profile has no card
   *  for it (gender, the Verification Fee): the button then opens `href`. */
  card: TutorCardKey | null
  done: boolean
}

const nonblank = (v: string | null | undefined) => !!(v && v.trim())

type Def = { key: string; step: FlowStepKey; label: string; button: string; card: TutorCardKey | null; done: (f: FlowFacts) => boolean }

/** The tutor's required items, in onboarding order. `level` and `subjects` are
 *  one choice; the contact step is shown as its two parts. */
const TUTOR_DEFS: Def[] = [
  { key: 'gender', step: 'gender', label: 'Choose your gender', button: 'Gender', card: null, done: (f) => stepDone(f, 'gender') },
  { key: 'city', step: 'city', label: 'Choose your city', button: 'City', card: 'location', done: (f) => stepDone(f, 'city') },
  { key: 'area', step: 'area', label: 'Add your teaching areas', button: 'Areas', card: 'location', done: (f) => stepDone(f, 'area') },
  { key: 'subjects', step: 'subjects', label: 'Add your subjects', button: 'Subjects', card: 'subjects', done: (f) => stepDone(f, 'subjects') },
  { key: 'jobtype', step: 'jobtype', label: 'Choose the work you want', button: 'Job type', card: 'jobType', done: (f) => stepDone(f, 'jobtype') },
  { key: 'fee', step: 'fee', label: 'Set your monthly fee', button: 'Monthly fee', card: 'monthlyFee', done: (f) => stepDone(f, 'fee') },
  // "New to teaching" (0 years) is an answer.
  { key: 'experience', step: 'experience', label: 'Add your years of experience', button: 'Experience', card: 'experience', done: (f) => stepDone(f, 'experience') },
  { key: 'degree', step: 'degree', label: 'Add your education', button: 'Education', card: 'degrees', done: (f) => stepDone(f, 'degree') },
  { key: 'availability', step: 'availability', label: 'Add your availability', button: 'Availability', card: 'availability', done: (f) => stepDone(f, 'availability') },
  { key: 'mobile', step: 'contact', label: 'Verify your mobile number', button: 'Mobile number', card: 'mobile', done: (f) => f.phoneVerified },
  { key: 'whatsapp', step: 'contact', label: 'Add your WhatsApp number', button: 'WhatsApp number', card: 'details', done: (f) => nonblank(f.whatsapp) },
  { key: 'photo', step: 'photo', label: 'Add your profile photo', button: 'Profile photo', card: 'profilePic', done: (f) => stepDone(f, 'photo') },
  { key: 'selfie', step: 'selfie', label: 'Take your selfie', button: 'Selfie', card: 'selfie', done: (f) => stepDone(f, 'selfie') },
  { key: 'cnic_number', step: 'cnic_number', label: 'Enter your CNIC number', button: 'CNIC number', card: 'cnic', done: (f) => stepDone(f, 'cnic_number') },
  { key: 'cnic_photos', step: 'cnic_photos', label: 'Add photos of your CNIC', button: 'CNIC photos', card: 'cnic', done: (f) => stepDone(f, 'cnic_photos') },
  { key: 'tagline', step: 'tagline', label: 'Write your tagline and bio', button: 'Tagline & About', card: 'about', done: (f) => stepDone(f, 'tagline') },
  { key: 'verify', step: 'verify', label: 'Pay the Verification Fee', button: 'Verification Fee', card: null, done: (f) => stepDone(f, 'verify') },
]

/** Keys that are never completion items, whatever else changes. */
export const NEVER_COUNTED = ['email', 'video'] as const

export function tutorRequiredItems(f: FlowFacts): RequiredItem[] {
  return TUTOR_DEFS.map(({ done, ...d }) => ({ ...d, done: done(f) }))
}

export type RequiredSummary<T extends { done: boolean } = RequiredItem> = {
  items: T[]
  missing: T[]
  done: number
  total: number
  percent: number
}

/** 100 only when every item is done; never rounded up early. */
export function requiredPercent(done: number, total: number): number {
  if (total <= 0 || done >= total) return 100
  return Math.min(99, Math.floor((done / total) * 100))
}

export function summariseRequired<T extends { done: boolean }>(items: T[]): RequiredSummary<T> {
  const missing = items.filter((i) => !i.done)
  const done = items.length - missing.length
  return { items, missing, done, total: items.length, percent: requiredPercent(done, items.length) }
}

export function tutorRequired(f: FlowFacts): RequiredSummary {
  return summariseRequired(tutorRequiredItems(f))
}

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

/** Parent Edit Profile tile keys: name and city live on 'details'. */
export type ParentCardKey = 'details' | 'mobile'
export type ParentRequiredItem = { key: string; label: string; button: string; card: ParentCardKey; done: boolean }

export type ParentRequiredFacts = { fullName: string | null; city: string | null; phoneVerified: boolean }

/** A parent needs a name, a city and a verified mobile (owner, 8 Oct 2026).
 *  Address and CNIC are optional suggestions; email never counts. */
export function parentRequiredItems(f: ParentRequiredFacts): ParentRequiredItem[] {
  return [
    { key: 'name', label: 'Add your full name', button: 'Name', card: 'details', done: nonblank(f.fullName) },
    { key: 'city', label: 'Choose your city', button: 'City', card: 'details', done: nonblank(f.city) },
    { key: 'phone', label: 'Verify your mobile number', button: 'Mobile number', card: 'mobile', done: f.phoneVerified },
  ]
}

// ---------------------------------------------------------------------------
// The plain line
// ---------------------------------------------------------------------------

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** "add your availability", "add your availability and your tagline…",
 *  "a, b and c" — the missing items as one phrase (at most `max`, then "and N
 *  more things"). */
export function missingPhrase(labels: string[], max = 3): string {
  const list = labels.map((l) => lowerFirst(l.trim())).filter(Boolean)
  if (list.length === 0) return ''
  const shown = list.slice(0, max)
  const more = list.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more thing${more === 1 ? '' : 's'}`
  if (shown.length === 1) return shown[0]
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** "93% — add your availability to reach 100%" / "100% — your profile is complete". */
export function completionLine(percent: number, missing: { label: string }[]): string {
  if (missing.length === 0 || percent >= 100) return '100% — your profile is complete'
  return `${percent}% — ${missingPhrase(missing.map((m) => m.label))} to reach 100%`
}

/** Where a tutor item's button goes from outside Edit Profile (the dashboard):
 *  the card on Edit Profile when there is one, else the step that fixes it. */
export function tutorItemHref(item: Pick<RequiredItem, 'card' | 'step' | 'key'>): string {
  if (item.key === 'verify') return '/pay/choose?plan=verified'
  if (item.card) return `/tutor/dashboard/settings?open=${item.card}`
  return `/tutor/complete-profile?step=${item.step}`
}

export function parentItemHref(item: Pick<ParentRequiredItem, 'card'>): string {
  return `/parent/dashboard/settings?open=${item.card}`
}

/** The missing tutor items as the line's buttons. */
export function tutorLineItems(missing: RequiredItem[]): { key: string; label: string; button: string; href: string; card: string | null }[] {
  return missing.map((m) => ({ key: m.key, label: m.label, button: m.button, href: tutorItemHref(m), card: m.card }))
}

/** The missing parent items as the line's buttons. */
export function parentLineItems(missing: ParentRequiredItem[]): { key: string; label: string; button: string; href: string; card: string | null }[] {
  return missing.map((m) => ({ key: m.key, label: m.label, button: m.button, href: parentItemHref(m), card: m.card }))
}

/** Which required items each Edit Profile card holds — the step counts on Edit
 *  Profile count only cards that hold a required item, and a card is done when
 *  none of its items is missing. Cards with none (email, certifications) are
 *  optional and left out of the counts. */
export const TUTOR_CARD_ITEMS: Record<string, string[]> = TUTOR_DEFS.reduce<Record<string, string[]>>((acc, d) => {
  if (d.card) (acc[d.card] ??= []).push(d.key)
  return acc
}, {})

/** Edit Profile's "done of total" for one group of cards, from the shared rule. */
export function cardStepCount(cardKeys: string[], missingKeys: string[]): { done: number; total: number } {
  const counted = cardKeys.filter((k) => (TUTOR_CARD_ITEMS[k] ?? []).length > 0)
  const missing = new Set(missingKeys)
  const done = counted.filter((k) => !(TUTOR_CARD_ITEMS[k] ?? []).some((i) => missing.has(i))).length
  return { done, total: counted.length }
}
