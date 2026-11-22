// PURE (scripts/test-pr16.ts). Fee positioning (PR-16, owner): the profile and
// browsing are free; the one-time Verification Fee unlocks applying and the
// Verified badge. Never "no fee", never an amount here (the amount appears only
// on /pay/choose). Tutor-facing lines that used to say "Free to join — apply"
// read these instead, so nothing implies a tutor can apply for free.

/** Tutor-facing: tuition hubs, tuition-job pages, JobPosting descriptions. */
export const FREE_PROFILE_APPLY_LINE = 'Free profile — verified tutors apply on TutorMint.'

/** The short form (no city). */
export const FREE_PROFILE_LINE = 'Free profile.'

/** Claims that a tutor pays nothing — never in shipped copy (test-pr16 scans). */
export const TUTOR_PAYS_NOTHING_RE =
  /\b(?:no fees?(?! figures?| amounts?| (?:to|for) (?:browse|browsing))|completely free to (?:apply|join)|100% free|totally free|absolutely free|apply (?:for )?free|free to apply)\b/i
