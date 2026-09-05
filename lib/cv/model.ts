// lib/cv/model.ts
//
// The CV data mapper — PURE, no server-only, no DB — so the on-screen preview
// and the PDF are built from the SAME function and can never diverge. The
// server reads the profile into a CvRaw (lib/cv/build.ts); this turns a CvRaw
// into the presentation-ready CvModel that both renderers consume.
//
// Three rules live here, and each is unit-tested:
//   * A section with no data is omitted, never rendered empty.
//   * The contact block appears only when the tutor asks for it.
//   * The photo is an avatar or nothing. Any URL that is not a public object in
//     our avatar buckets — an identity-docs object above all — is rejected, so
//     a CNIC or a selfie can never reach a CV.

import { isOurStorageUrl } from '@/lib/avatarUrl'
import { teachingMode } from '@/lib/display'

export type CvSubjectGroup = { level: string; subjects: string[] }

/** What the server reads from the profile. Serialisable — the client mapper
    re-runs on the contact toggle without a round trip. */
export type CvRaw = {
  fullName: string
  /** profiles.avatar_url — validated here, never trusted as-is. */
  avatarUrl: string | null
  city: string | null
  area: string | null
  headline: string | null
  bio: string | null
  subjectGroups: CvSubjectGroup[]
  degrees: string[]
  experienceYears: number | null
  teachingMode: string | null
  languages: string[]
  phone: string | null
  whatsapp: string | null
  email: string | null
  slug: string | null
  profileUrl: string
  completion: number
}

export type CvContact = { phone?: string; whatsapp?: string; email?: string }

export type CvModel = {
  name: string
  /** A validated avatar URL, or null. Never an identity document. */
  photoUrl: string | null
  headline: string | null
  about: string | null
  subjects: CvSubjectGroup[]
  degrees: string[]
  experienceYears: number | null
  location: string | null
  teachingMode: string | null
  languages: string[]
  contact: CvContact | null
  profileUrl: string
  completion: number
}

export type CvOptions = { includeContact: boolean }

function clean(s: string | null | undefined): string | null {
  const v = (s ?? '').trim()
  return v.length > 0 ? v : null
}

/** The first subject a tutor teaches, for the "top subject · city" headline. */
function topSubject(groups: CvSubjectGroup[]): string | null {
  for (const g of groups) {
    if (g.subjects.length > 0) return g.subjects[0]
    if (clean(g.level)) return g.level
  }
  return null
}

export function toCvModel(raw: CvRaw, opts: CvOptions): CvModel {
  // Photo: an avatar in one of OUR public buckets, or nothing. isOurStorageUrl
  // allows only 'avatars'/'tutor-media' — an identity-docs URL, a data: URI or
  // a foreign host is rejected, so a CNIC or selfie cannot appear on a CV.
  const photoUrl = raw.avatarUrl && isOurStorageUrl(raw.avatarUrl) ? raw.avatarUrl : null

  const headline =
    [topSubject(raw.subjectGroups), clean(raw.city)].filter(Boolean).join(' · ') ||
    clean(raw.headline) ||
    null

  const location = [clean(raw.area), clean(raw.city)].filter(Boolean).join(', ') || null

  // Subjects: drop groups that carry no level and no subjects.
  const subjects = raw.subjectGroups.filter((g) => clean(g.level) || g.subjects.length > 0)

  const degrees = raw.degrees.map((d) => d.trim()).filter((d) => d.length > 0)
  const languages = raw.languages.map((l) => l.trim()).filter((l) => l.length > 0)

  let contact: CvContact | null = null
  if (opts.includeContact) {
    const c: CvContact = {}
    if (clean(raw.phone)) c.phone = clean(raw.phone)!
    if (clean(raw.whatsapp)) c.whatsapp = clean(raw.whatsapp)!
    if (clean(raw.email)) c.email = clean(raw.email)!
    contact = Object.keys(c).length > 0 ? c : null
  }

  return {
    name: raw.fullName.trim() || 'Tutor',
    photoUrl,
    headline,
    about: clean(raw.bio),
    subjects,
    degrees,
    experienceYears: raw.experienceYears && raw.experienceYears > 0 ? raw.experienceYears : null,
    location,
    teachingMode: teachingMode(raw.teachingMode),
    languages,
    contact,
    profileUrl: raw.profileUrl,
    completion: raw.completion,
  }
}

export type CvTemplate = 'classic' | 'minimal'

export function isCvTemplate(v: string | null | undefined): v is CvTemplate {
  return v === 'classic' || v === 'minimal'
}
