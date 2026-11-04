// lib/profileChecklist.ts
//
// The single source of truth for profile completion, for both roles. Server
// routes, the completion widget and the multi-step form all read from here, so
// the percentage can never disagree between screens.
//
// Rule that shapes the whole file: completion must NEVER depend on an admin
// action. A tutor reaches 100% by submitting a video, not by having it
// approved; by uploading a CNIC, not by having it verified. Admin review is a
// separate axis (verification_status / verification_state) and gates badges
// and listings, not the percentage.

import { COMPLETION_KEY_TO_STEP, type FlowFacts } from '@/lib/tutorFlow'
import { parentRequiredItems, requiredPercent, tutorItemHref, tutorRequiredItems, type RequiredItem } from '@/lib/profileRequired'

/** A tutor item by key, for links (built from an empty profile — only the
 *  static parts, card and step, are read). */
function tutorItemByKey(key: string): RequiredItem | undefined {
  return tutorRequiredItems(completionInputToFacts({})).find((i) => i.key === key)
}
import { isSyntheticEmail } from '@/lib/phone'

/** A real, sendable email is on file — present and not the synthetic
 *  <msisdn>@users.tutormint.org address a mobile signup carries (PR29 §4). A
 *  synthetic address is confirmed nowhere and delivered to nowhere, so it does
 *  not count. A member's real email only reaches profiles.email once its
 *  confirmation link is clicked (app/api/auth/callback), so "present and real"
 *  IS "confirmed". */
export function hasRealEmail(email: string | null | undefined): boolean {
  return !!(email && email.trim()) && !isSyntheticEmail(email)
}

export type ChecklistItem = {
  key: string
  label: string
  done: boolean
  /** Which step of /tutor/complete-profile fixes this. */
  step: number
  /** Anchor within that step, for deep links. */
  anchor: string
  /** A suggestion, not a requirement (owner, 8 Oct 2026): a parent's CNIC and
   *  address earn the Verified badge but block nothing, so they do not count
   *  toward the percentage and are never "missing". */
  optional?: boolean
}

export type Completion = {
  percent: number
  items: ChecklistItem[]
  missing: ChecklistItem[]
  /** Optional items not done yet — shown as suggestions, never as blockers. */
  suggestions: ChecklistItem[]
}

/**
 * The deep link that fixes one checklist item. One definition, so the dashboard
 * card, the Needs you strip and the admin list all point at the same place.
 *
 * For a TUTOR this opens the exact step of the tap-tap flow (PR 4 §1.6):
 * /tutor/complete-profile?step=<flow key>. The completion item key maps to the
 * flow step via COMPLETION_KEY_TO_STEP (lib/tutorFlow), unit-tested to cover
 * every item so a link never dead-ends. Parents keep the step-tab verify flow.
 */
export function checklistHref(role: 'tutor' | 'parent', item: ChecklistItem): string {
  // The email item is added and confirmed in Settings, not in the gap-flow /
  // verify screens — a confirmation link, not a field on a form (PR29 §4). So it
  // is the one item whose link goes to Settings for both roles.
  if (item.key === 'email') {
    return role === 'tutor' ? '/tutor/dashboard/settings#email' : '/parent/dashboard/settings#email'
  }
  if (role === 'tutor') {
    const req = tutorItemByKey(item.key)
    if (req) return tutorItemHref(req)
    const step = COMPLETION_KEY_TO_STEP[item.key] ?? 'city'
    return `/tutor/complete-profile?step=${step}`
  }
  return `/parent/verify?step=${item.step}#${item.anchor}`
}

const has = (v: unknown): boolean => {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'number') return Number.isFinite(v) && v > 0
  return Boolean(v)
}

/** Shape the engine needs. Kept loose so callers can pass joined rows. */
export type TutorCompletionInput = {
  profile?: {
    full_name?: string | null
    city?: string | null
    email?: string | null
    cnic_number?: string | null
    cnic_image_path?: string | null
    phone_verified_at?: string | null
    whatsapp?: string | null
  } | null
  tutorProfile?: {
    gender?: string | null
    area?: string | null
    avatar_url?: string | null
    headline?: string | null
    bio?: string | null
    experience_years?: number | null
    hourly_rate_pkr?: number | null
    teaching_mode?: string | null
    job_types?: string[] | null
    degrees?: string[] | null
    video_youtube_id?: string | null
    video_status?: string | null
    fee_min_pkr?: number | null
    no_degree_yet?: boolean | null
  } | null
  /** Count of tutor_subjects rows (taxonomy_master ids). */
  subjectCount?: number
  /** Count of user_documents rows with kind='degree'. */
  degreeDocCount?: number
  /** Whether the one-time verification fee is paid (tutor_profiles
   *  .verified_fee_paid_at). The 16th flow step (owner PR5a §3.1) — paying it is
   *  the member's own action, so it counts toward completion like every other
   *  step. */
  feePaid?: boolean
  /** Time slots on file (tutor_profiles.availability_list). */
  availabilityCount?: number
  /** A selfie document is on file. */
  selfieDone?: boolean
  /** Both CNIC sides are on file. When left out, profiles.cnic_image_path is read. */
  cnicPhotosDone?: boolean
}

export type ParentCompletionInput = {
  profile?: {
    full_name?: string | null
    city?: string | null
    email?: string | null
    address?: string | null
    cnic_number?: string | null
    cnic_image_path?: string | null
    phone_verified_at?: string | null
  } | null
}

/**
 * Tutor completion — THE shared rule (owner, 4 Nov 2026; lib/profileRequired):
 * the 17 things the onboarding flow asks for. Email and the intro video never
 * count. The percentage floors, so a finished profile is exactly 100 and
 * nothing else ever is.
 */
export function calculateTutorCompletion(input: TutorCompletionInput): Completion {
  return tutorCompletionFromFacts(completionInputToFacts(input))
}

/** The completion input as the flow's facts (what the shared rule reads). */
export function completionInputToFacts(input: TutorCompletionInput): FlowFacts {
  const p = input.profile ?? {}
  const t = input.tutorProfile ?? {}
  const degrees = Array.isArray(t.degrees) ? (t.degrees as unknown[]) : []
  return {
    fullName: p.full_name ?? null,
    gender: t.gender ?? null,
    city: p.city ?? null,
    area: t.area ?? null,
    avatarUrl: t.avatar_url ?? null,
    headline: t.headline ?? null,
    bio: t.bio ?? null,
    experienceYears: t.experience_years ?? null,
    hourlyRate: t.fee_min_pkr ?? t.hourly_rate_pkr ?? null,
    jobTypes: t.job_types ?? [],
    degreesCount: degrees.length,
    degreeDocCount: input.degreeDocCount ?? 0,
    degrees,
    cnicNumber: p.cnic_number ?? null,
    cnicImagePath: input.cnicPhotosDone === undefined ? p.cnic_image_path ?? null : input.cnicPhotosDone ? 'y' : null,
    subjectCount: input.subjectCount ?? 0,
    selfieDone: !!input.selfieDone,
    availabilityCount: input.availabilityCount ?? 0,
    phoneVerified: has(p.phone_verified_at),
    whatsapp: p.whatsapp ?? null,
    feePaid: !!input.feePaid,
    noDegreeYet: !!t.no_degree_yet,
    isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
    verificationStatus: null, imported: false, claimedAt: null,
  }
}

/** The shared rule over the flow's facts, as a checklist. */
export function tutorCompletionFromFacts(f: FlowFacts): Completion {
  const items: ChecklistItem[] = tutorRequiredItems(f).map((i, n) => ({
    key: i.key,
    label: i.label,
    done: i.done,
    step: n + 1,
    anchor: i.step,
  }))
  return summarise(items)
}

/** Parent completion: name, city and a verified mobile are REQUIRED (owner,
 *  8 Oct 2026 — a verified mobile is all a parent needs to post, message and
 *  request demos). Home address, CNIC number and CNIC image are OPTIONAL
 *  suggestions: approved, they earn the green Verified badge. */
export function calculateParentCompletion(input: ParentCompletionInput): Completion {
  const p = input.profile ?? {}
  // The required items are the shared rule (lib/profileRequired); email never
  // counts (owner, 5 Oct and 4 Nov 2026).
  const required: ChecklistItem[] = parentRequiredItems({
    fullName: p.full_name ?? null,
    city: p.city ?? null,
    phoneVerified: has(p.phone_verified_at),
  }).map((i, n) => ({ key: i.key, label: i.label, done: i.done, step: n + 1, anchor: i.card }))
  const optional: ChecklistItem[] = [
    { key: 'address', label: 'Home address (optional)', done: has(p.address), step: 1, anchor: 'address', optional: true },
    { key: 'cnic_number', label: 'CNIC number (optional)', done: has(p.cnic_number), step: 2, anchor: 'cnic_number', optional: true },
    { key: 'cnic_image', label: 'CNIC image (optional)', done: has(p.cnic_image_path), step: 2, anchor: 'cnic_image', optional: true },
  ]
  return summarise([...required, ...optional])
}

function summarise(items: ChecklistItem[]): Completion {
  const required = items.filter((i) => !i.optional)
  const done = required.filter((i) => i.done).length
  // Exactly 100 only when every REQUIRED item is done; never round up early.
  const percent = requiredPercent(done, required.length)
  return {
    percent,
    items,
    missing: required.filter((i) => !i.done),
    suggestions: items.filter((i) => i.optional && !i.done),
  }
}

// ---------------------------------------------------------------------------
// Legacy names kept so nothing that still imports them breaks. They forward to
// the engine above rather than carrying a second, divergent set of rules.
// ---------------------------------------------------------------------------
export function calculateTutorProfileCompletion(profile: any) {
  const c = calculateTutorCompletion({ profile, tutorProfile: profile })
  return { score: c.percent, checklist: Object.fromEntries(c.items.map((i) => [i.key, i.done])) }
}

export function calculateParentProfileCompletion(profile: any) {
  const c = calculateParentCompletion({ profile })
  return { score: c.percent, checklist: Object.fromEntries(c.items.map((i) => [i.key, i.done])) }
}
