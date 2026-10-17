// lib/tutorCardCore.ts
//
// What the tutor LISTING card shows (owner, 17 Oct 2026). The card on Browse,
// search, city and landing pages, the shortlist and blog embeds is a summary;
// the full profile page keeps every role, subject and area.
//
//   • Roles: at most 2, then "+N".
//   • Subjects: one line, at most 4, each once (lib/subjectDisplay), then "+N more".
//   • One info line: city · experience · fee range per month (as the tutor set it).
//   • No areas on the card.
//
// PURE — the card renders exactly this and the tests read the same function.

import { dedupeSubjects } from './subjectDisplay'
import { feeLabelOf } from './fee'
import { experienceLabel } from './experienceLabel'

export const CARD_MAX_ROLES = 2
export const CARD_MAX_SUBJECTS = 4

export type CardSubject = { label: string; masterId?: number; href?: string }

export type CardSummaryInput = {
  job_types: string[] | null
  subject_labels: string[] | null
  subject_links?: { label: string; masterId: number; href?: string }[]
  city: string | null
  cities?: string[] | null
  experience_years: number | null
  hourly_rate_pkr: number | null
  fee_min_pkr?: number | null
  fee_max_pkr?: number | null
}

export type CardSummary = {
  roles: string[]
  rolesExtra: number
  subjects: CardSubject[]
  subjectsExtra: number
  /** The first city, or null when the tutor has none (taught online). */
  city: string | null
  experience: string
  /** "Rs 5,000 – 20,000/month", or null when no fee is set. */
  fee: string | null
}

export function cardSummary(t: CardSummaryInput): CardSummary {
  const roles = (t.job_types ?? []).map((r) => r.trim()).filter(Boolean)
  const uniqueRoles = [...new Set(roles)]

  const linked = t.subject_links ?? []
  const all: CardSubject[] = dedupeSubjects<CardSubject>(
    linked.length > 0 ? linked : (t.subject_labels ?? []).map((label) => ({ label })),
  )

  const city = (t.cities && t.cities.length > 0 ? t.cities[0] : t.city)?.trim() || null
  const fee = feeLabelOf(t)

  return {
    roles: uniqueRoles.slice(0, CARD_MAX_ROLES),
    rolesExtra: Math.max(0, uniqueRoles.length - CARD_MAX_ROLES),
    subjects: all.slice(0, CARD_MAX_SUBJECTS),
    subjectsExtra: Math.max(0, all.length - CARD_MAX_SUBJECTS),
    city,
    experience: experienceLabel(t.experience_years).en,
    fee: fee ? fee.replace(/ \/ month$/, '/month') : null,
  }
}
