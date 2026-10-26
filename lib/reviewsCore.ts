// lib/reviewsCore.ts — PURE. Parent reviews (owner, 27 Oct 2026).
//
//   - Only a parent whose application with a tutor is at stage Hired may review
//     that tutor — the parent who POSTED that tuition — once per hire (one
//     review per application). The database enforces the same rule
//     (can_review_hire() behind the insert policy, a unique index on
//     application_id; migration 204), so a bypassed route still cannot.
//   - A review is a 1–5 rating and a short text, saved as PENDING.
//   - The site Owner approves or rejects it (Trust → Reviews). Only APPROVED
//     reviews are public, show on the tutor's profile and count in the rating.
//   - No review structured data (JSON-LD) is emitted anywhere.

export const REVIEW_MIN_CHARS = 10
export const REVIEW_MAX_CHARS = 600

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
}

export function parseReviewStatus(v: string | null | undefined): ReviewStatus {
  return v === 'approved' || v === 'rejected' ? v : 'pending'
}

/** The problem with a rating + text, or null. */
export function reviewInputProblem(rating: unknown, comment: unknown): string | null {
  const r = Number(rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) return 'Choose a rating from 1 to 5.'
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (text.length < REVIEW_MIN_CHARS) return 'Write a sentence or two about the tutor.'
  if (text.length > REVIEW_MAX_CHARS) return `Please keep it under ${REVIEW_MAX_CHARS} characters.`
  return null
}

export type HireFacts = {
  /** The application's own fields. */
  stage: string | null
  status: string | null
  tutorId: string
  /** Who posted the tuition the application is for. */
  jobParentId: string | null
}

export type EligibilityResult = { ok: true } | { ok: false; status: 403 | 404 | 409; error: string }

export const REVIEW_NOT_HIRED = 'You can review a tutor after you hire them through TutorMint.'
export const REVIEW_ALREADY = 'You have already reviewed this tutor for this tuition.'

/** May this parent review this hire? (The database checks it again.) */
export function reviewEligibility(parentId: string, hire: HireFacts | null, alreadyReviewed: boolean): EligibilityResult {
  if (!hire) return { ok: false, status: 404, error: 'This tuition could not be found.' }
  if (hire.jobParentId !== parentId) return { ok: false, status: 403, error: REVIEW_NOT_HIRED }
  if (hire.tutorId === parentId) return { ok: false, status: 403, error: 'You cannot review yourself.' }
  if (hire.stage !== 'hired' || hire.status === 'withdrawn') return { ok: false, status: 403, error: REVIEW_NOT_HIRED }
  if (alreadyReviewed) return { ok: false, status: 409, error: REVIEW_ALREADY }
  return { ok: true }
}

/** What a member reads after sending a review. */
export const REVIEW_SENT_MESSAGE = 'Thank you. Your review will appear on the tutor’s profile once our team has checked it.'

/** Only approved reviews are public and count in the rating. */
export function countsInRating(status: string | null | undefined): boolean {
  return status === 'approved'
}

export function ratingSummary(reviews: { rating: number; status: string | null }[]): { avg: number; count: number } {
  const approved = reviews.filter((r) => countsInRating(r.status))
  if (!approved.length) return { avg: 0, count: 0 }
  const avg = Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 100) / 100
  return { avg, count: approved.length }
}
