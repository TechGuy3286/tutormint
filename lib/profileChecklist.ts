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

import { COMPLETION_KEY_TO_STEP } from '@/lib/tutorFlow'
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
}

export type Completion = {
  percent: number
  items: ChecklistItem[]
  missing: ChecklistItem[]
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
 * Tutor completion. 17 equally weighted items — the 16 gap-flow steps plus the
 * contact-email item (PR29 §4), which is fixed in Settings, not the flow. The
 * percentage floors so a finished profile is exactly 100 and nothing else ever
 * is.
 */
export function calculateTutorCompletion(input: TutorCompletionInput): Completion {
  const p = input.profile ?? {}
  const t = input.tutorProfile ?? {}

  const items: ChecklistItem[] = [
    // The one-time verification fee — the flow's 'verify' step. A blocker (it is
    // in the not-listed card), so the dashboard widget hides it from the LIST,
    // but it still counts toward "X of 16 done".
    { key: 'verify', label: 'Verification fee paid', done: !!input.feePaid, step: 6, anchor: 'verify' },
    { key: 'name', label: 'Your full name', done: has(p.full_name), step: 1, anchor: 'full_name' },
    { key: 'gender', label: 'Gender', done: has(t.gender), step: 1, anchor: 'gender' },
    { key: 'city', label: 'City', done: has(p.city), step: 1, anchor: 'city' },
    { key: 'area', label: 'Area', done: has(t.area), step: 1, anchor: 'area' },
    { key: 'photo', label: 'Profile photo', done: has(t.avatar_url), step: 2, anchor: 'avatar' },
    { key: 'tagline', label: 'Professional tagline', done: has(t.headline), step: 2, anchor: 'headline' },
    { key: 'bio', label: 'About you', done: has(t.bio), step: 2, anchor: 'bio' },
    { key: 'subjects', label: 'At least one subject', done: (input.subjectCount ?? 0) > 0, step: 3, anchor: 'subjects' },
    { key: 'experience', label: 'Years of experience', done: has(t.experience_years), step: 4, anchor: 'experience_years' },
    { key: 'fee', label: 'Expected fee', done: has(t.hourly_rate_pkr), step: 4, anchor: 'hourly_rate_pkr' },
    { key: 'mode', label: 'Job Type', done: (t.job_types?.length ?? 0) > 0, step: 4, anchor: 'teaching_mode' },
    {
      key: 'degrees',
      label: 'Degrees listed with a certificate image',
      // Both halves are required: the typed list AND at least one certificate.
      done: has(t.degrees) && (input.degreeDocCount ?? 0) > 0,
      step: 5,
      anchor: 'degrees',
    },
    {
      key: 'cnic',
      label: 'CNIC number and image',
      done: has(p.cnic_number) && has(p.cnic_image_path),
      step: 5,
      anchor: 'cnic',
    },
    { key: 'phone', label: 'Mobile number verified', done: has(p.phone_verified_at), step: 6, anchor: 'phone' },
    // The other contact channel (PR29 §4). A mobile signup carries a synthetic
    // address, so this asks them to add and confirm a real email; an email
    // signup already has one, so it is done. Added in Settings, confirmed by a
    // link — checklistHref sends it there, not to a gap-flow step.
    { key: 'email', label: 'Email address', done: hasRealEmail(p.email), step: 6, anchor: 'email' },
    {
      key: 'video',
      label: 'Introduction video submitted',
      // Submitted, not approved. Admin review must not move the percentage.
      done: has(t.video_youtube_id) || (t.video_status ? t.video_status !== 'none' : false),
      step: 7,
      anchor: 'video',
    },
  ]

  return summarise(items)
}

/** Parent completion: name, city, address, CNIC number + image, phone verified. */
export function calculateParentCompletion(input: ParentCompletionInput): Completion {
  const p = input.profile ?? {}

  const items: ChecklistItem[] = [
    { key: 'name', label: 'Your full name', done: has(p.full_name), step: 1, anchor: 'full_name' },
    { key: 'city', label: 'City', done: has(p.city), step: 1, anchor: 'city' },
    { key: 'address', label: 'Home address', done: has(p.address), step: 1, anchor: 'address' },
    { key: 'cnic_number', label: 'CNIC number', done: has(p.cnic_number), step: 2, anchor: 'cnic_number' },
    { key: 'cnic_image', label: 'CNIC image', done: has(p.cnic_image_path), step: 2, anchor: 'cnic_image' },
    { key: 'phone', label: 'Mobile number verified', done: has(p.phone_verified_at), step: 3, anchor: 'phone' },
    // The other contact channel (PR29 §4) — added and confirmed in Settings.
    { key: 'email', label: 'Email address', done: hasRealEmail(p.email), step: 3, anchor: 'email' },
  ]

  return summarise(items)
}

function summarise(items: ChecklistItem[]): Completion {
  const done = items.filter((i) => i.done).length
  // Exactly 100 only when everything is done; never round up to 100 early.
  const raw = (done / items.length) * 100
  const percent = done === items.length ? 100 : Math.min(99, Math.floor(raw))
  return { percent, items, missing: items.filter((i) => !i.done) }
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
