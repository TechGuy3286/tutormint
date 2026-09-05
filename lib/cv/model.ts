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
import { levelLabel, teachingMode } from '@/lib/display'

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

  // Subjects: drop groups with no level and no subjects, and route every level
  // through the ONE display mapper the public profile uses ("O Level", not "O
  // Levels"), so the two surfaces cannot diverge.
  const subjects = raw.subjectGroups
    .filter((g) => clean(g.level) || g.subjects.length > 0)
    .map((g) => ({ level: levelLabel(g.level), subjects: g.subjects }))

  const headline =
    [topSubject(subjects), clean(raw.city)].filter(Boolean).join(' · ') ||
    clean(raw.headline) ||
    null

  const location = [clean(raw.area), clean(raw.city)].filter(Boolean).join(', ') || null

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

// A contact row, resolved once here so the preview and the PDF render the same
// lines. When phone and WhatsApp are the same number they collapse to one
// "Phone / WhatsApp" line rather than printing the same digits twice.
export type CvContactRow = { kind: 'phone' | 'email'; label: string | null; value: string }

function sameNumber(a: string, b: string): boolean {
  const digits = (x: string) => x.replace(/\D/g, '')
  const da = digits(a)
  const db = digits(b)
  return da.length > 0 && da === db
}

export function cvContactRows(contact: CvContact | null): CvContactRow[] {
  if (!contact) return []
  const rows: CvContactRow[] = []
  const { phone, whatsapp, email } = contact
  if (phone && whatsapp && sameNumber(phone, whatsapp)) {
    rows.push({ kind: 'phone', label: 'Phone / WhatsApp', value: phone })
  } else {
    if (phone) rows.push({ kind: 'phone', label: null, value: phone })
    if (whatsapp) rows.push({ kind: 'phone', label: 'WhatsApp', value: whatsapp })
  }
  if (email) rows.push({ kind: 'email', label: null, value: email })
  return rows
}

// ---------------------------------------------------------------------------
// The rendered content — every label, in ONE place.
// ---------------------------------------------------------------------------
//
// The preview (components/cv/CvPreview.tsx) and the PDF (lib/cv/pdf.tsx) both
// render from cvSections()/cvTextLines() and build NO display string of their
// own — so the two cannot diverge on the wording of a heading, a "5 years of
// experience", or a contact line. scripts/test-cv.ts serialises the preview and
// asserts it equals cvTextLines(model); the PDF renders the same lines by
// construction (it cannot be imported under the tsx test runner — the
// @react-pdf/hyphenate CJS export gap — so its equality rests on reading the
// same functions plus the live smoke).

export type CvIcon = 'book' | 'briefcase' | 'monitor' | 'pin' | 'graduation' | 'phone' | 'mail'

/** A line in a section. `icon: null` is a plain paragraph (About, Languages). */
export type CvLine = { icon: CvIcon | null; text: string }
export type CvSection = { key: string; heading: string; lines: CvLine[] }

function experienceLine(years: number): string {
  return `${years} year${years === 1 ? '' : 's'} of experience`
}

export function cvSections(model: CvModel): CvSection[] {
  const sections: CvSection[] = []

  if (model.about) {
    sections.push({ key: 'about', heading: 'About', lines: [{ icon: null, text: model.about }] })
  }

  if (model.subjects.length > 0) {
    sections.push({
      key: 'subjects',
      heading: 'Subjects',
      lines: model.subjects.map((g) => ({
        icon: 'book' as const,
        text: g.subjects.length > 0 ? `${g.level} — ${g.subjects.join(', ')}` : g.level,
      })),
    })
  }

  const teaching: CvLine[] = []
  if (model.experienceYears) teaching.push({ icon: 'briefcase', text: experienceLine(model.experienceYears) })
  if (model.location) teaching.push({ icon: 'pin', text: model.location })
  if (model.teachingMode) teaching.push({ icon: 'monitor', text: model.teachingMode })
  if (teaching.length > 0) sections.push({ key: 'teaching', heading: 'Teaching', lines: teaching })

  if (model.degrees.length > 0) {
    sections.push({
      key: 'education',
      heading: 'Education',
      lines: model.degrees.map((d) => ({ icon: 'graduation' as const, text: d })),
    })
  }

  if (model.languages.length > 0) {
    sections.push({
      key: 'languages',
      heading: 'Languages',
      lines: [{ icon: null, text: model.languages.join(', ') }],
    })
  }

  const contactRows = cvContactRows(model.contact)
  if (contactRows.length > 0) {
    sections.push({
      key: 'contact',
      heading: 'Contact',
      lines: contactRows.map((r) => ({
        icon: (r.kind === 'email' ? 'mail' : 'phone') as CvIcon,
        text: r.label ? `${r.label}: ${r.value}` : r.value,
      })),
    })
  }

  return sections
}

/** The CV's full visible text, in order: header, every section, footer. The
    single source both renderers are checked against. */
export function cvTextLines(model: CvModel): string[] {
  const lines: string[] = [model.name]
  if (model.headline) lines.push(model.headline)
  for (const s of cvSections(model)) {
    lines.push(s.heading)
    for (const l of s.lines) lines.push(l.text)
  }
  lines.push('Verified tutor on TutorMint')
  lines.push(model.profileUrl)
  return lines
}

export type CvTemplate = 'classic' | 'minimal'

export function isCvTemplate(v: string | null | undefined): v is CvTemplate {
  return v === 'classic' || v === 'minimal'
}
