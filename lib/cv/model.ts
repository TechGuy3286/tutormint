// lib/cv/model.ts
//
// The CV data mapper — PURE, no server-only, no DB — so the on-screen preview
// and the PDF are built from the SAME function and can never diverge. The
// server reads the profile into a CvRaw (lib/cv/build.ts); this turns a CvRaw
// into the presentation-ready CvModel that both renderers consume.
//
// Rules that live here (each unit-tested in scripts/test-cv.ts):
//   * A section with no data is omitted, never rendered empty.
//   * Contact, fee and photo appear only when the tutor ticks them (fee is off
//     by default).
//   * The photo is an avatar in OUR avatar buckets or nothing — never an
//     identity document. A hidden photo is never used: the grey silhouette for
//     the tutor's gender takes its place.
//   * ONE experience phrase, from experience_years, in About and Teaching alike.
//   * Phones read "0321 1234567"; WhatsApp is shown only when the profile has it.
//   * Every area the tutor chose is shown.
//   * "Verified tutor on TutorMint" (and the ✓) only for a verified tutor.
//   * Degrees typed in capitals read in Title Case — display only.
//   * Never a CNIC number.

import { isOurStorageUrl } from '@/lib/avatarUrl'
import { jobType } from '@/lib/display'
import { feeRangeLabel } from '@/lib/fee'
import { degreeLabels } from '@/lib/degrees'
import { distinctAreaLabels } from '@/lib/place'
import { defaultAvatarKind, type DefaultAvatarKind } from '@/lib/defaultAvatar'
import {
  alignExperience,
  cutAtWord,
  fitGrid,
  moreLine,
  cvPhone,
  cvTitleLine,
  displayCase,
  experiencePhrase,
  subjectGrid,
  withoutCnic,
  type CvGridCell,
  type CvSubjectGroup,
} from '@/lib/cv/textRules'

export type { CvSubjectGroup, CvGridCell }

/** What the server reads from the profile. Serialisable — the client mapper
    re-runs on the tick boxes without a round trip. */
export type CvRaw = {
  fullName: string
  /** profiles.avatar_url — validated here, never trusted as-is. Null when the
   *  tutor hid their photo (build.ts never passes a hidden photo on). */
  avatarUrl: string | null
  /** "Hide my photo from parents" is on. */
  photoHidden?: boolean
  /** tutor_profiles.gender — picks the grey silhouette. */
  gender?: string | null
  city: string | null
  /** Legacy single area (tutor_profiles.area), used only when `areas` is empty. */
  area: string | null
  /** Every area the tutor chose (tutor_areas), with its city. */
  areas?: { area: string; city: string | null }[]
  headline: string | null
  bio: string | null
  subjectGroups: CvSubjectGroup[]
  degrees: string[]
  experienceYears: number | null
  /** Monthly fee range (PR67). Falls back to hourlyRatePkr. */
  feeMinPkr?: number | null
  feeMaxPkr?: number | null
  hourlyRatePkr?: number | null
  /** Legacy single Job Type (primary), kept as a fallback. */
  teachingMode: string | null
  /** The tutor's full set of Job Types — what the CV actually shows. */
  jobTypes: string[] | null
  languages: string[]
  phone: string | null
  whatsapp: string | null
  email: string | null
  slug: string | null
  profileUrl: string
  completion: number
  /** The site's Verified badge rule (lib/badgeRule), decided on the server. */
  verified?: boolean
  /** The saved accent colour (tutor_profiles.cv_accent). */
  accent?: CvAccent | null
}

export type CvContact = { phone?: string; whatsapp?: string; email?: string }

export type CvPhoto = { kind: 'photo'; url: string } | { kind: 'silhouette'; avatar: DefaultAvatarKind }

export type CvModel = {
  name: string
  /** The picture to draw, or null when "Include photo" is off. */
  photo: CvPhoto | null
  /** Back-compat: the validated avatar URL when a real photo is drawn. */
  photoUrl: string | null
  verified: boolean
  /** "<short subject summary> tutor · <City>". */
  headline: string | null
  about: string | null
  subjects: CvSubjectGroup[]
  grid: CvGridCell[]
  /** "+N more on my profile" when the grid was cut to fit, else null. */
  subjectsMore: string | null
  degrees: string[]
  experience: string | null
  /** "Rs 5,000 – 100,000 / month", only when "Include my fee" is ticked. */
  feeLabel: string | null
  city: string | null
  /** Every area label, city taken off ("DHA", "Bahria Town", "Cantt"). */
  areas: string[]
  /** "+N more" when the area list was cut to fit the sidebar, else null. */
  areasMore: string | null
  /** "DHA, Bahria Town, Cantt, Lahore". */
  location: string | null
  /** Teaching mode words: "Home", "Online", or the job title as written. */
  modes: string[]
  teachingMode: string | null
  languages: string[]
  contact: CvContact | null
  footer: string
  profileUrl: string
  completion: number
}

export type CvOptions = {
  includeContact: boolean
  includeFee?: boolean
  includePhoto?: boolean
  /** Which layout the model is cut to fit (one A4 page). Default modern. */
  template?: CvTemplate
}

/** What fits on ONE A4 page, per template. Checked by rendering every template
 *  with a very long profile in scripts/test-cv-pdf.mts. */
export const CV_BUDGET: Record<CvTemplate, { about: number; cells: number; perCell: number; degrees: number; degreeChars: number; areas: number; name: number }> = {
  modern: { about: 560, cells: 8, perCell: 6, degrees: 4, degreeChars: 90, areas: 8, name: 90 },
  classic: { about: 560, cells: 8, perCell: 8, degrees: 4, degreeChars: 110, areas: 10, name: 90 },
  minimal: { about: 650, cells: 8, perCell: 8, degrees: 4, degreeChars: 110, areas: 10, name: 90 },
}

function clean(s: string | null | undefined): string | null {
  const v = withoutCnic(s ?? '')
  return v.length > 0 ? v : null
}

export const VERIFIED_FOOTER = 'Verified tutor on TutorMint'
export const PLAIN_FOOTER = 'Tutor on TutorMint'

/** Teaching mode words from the tutor's Job Types. */
export function teachingModes(jobTypes: string[] | null, legacy: string | null): string[] {
  const types = (jobTypes && jobTypes.length > 0 ? jobTypes : [legacy]).map((t) => jobType(t)).filter(Boolean) as string[]
  const out: string[] = []
  for (const t of types) {
    const word = /^home tutor$/i.test(t) ? 'Home' : /^online tutor$/i.test(t) ? 'Online' : t
    if (!out.includes(word)) out.push(word)
  }
  return out
}

export function toCvModel(raw: CvRaw, opts: CvOptions): CvModel {
  const includePhoto = opts.includePhoto ?? true
  const budget = CV_BUDGET[opts.template ?? 'modern']
  // Photo: an avatar in one of OUR public buckets, or the silhouette. Hidden →
  // silhouette, whatever URL arrived.
  const validUrl = !raw.photoHidden && raw.avatarUrl && isOurStorageUrl(raw.avatarUrl) ? raw.avatarUrl : null
  const photo: CvPhoto | null = !includePhoto
    ? null
    : validUrl
      ? { kind: 'photo', url: validUrl }
      : { kind: 'silhouette', avatar: defaultAvatarKind(raw.gender) }

  const subjects = raw.subjectGroups.filter((g) => (g.level ?? '').trim() || g.subjects.length > 0)
  const fullGrid = subjectGrid(subjects)
  const allSubjects = fullGrid.flatMap((c) => (c.subjects.length > 0 ? c.subjects : [c.label]))
  const fitted = fitGrid(fullGrid, budget.cells, budget.perCell)

  const city = clean(raw.city)
  const areaInput = raw.areas && raw.areas.length > 0 ? raw.areas : raw.area ? [{ area: raw.area, city: raw.city }] : []
  const areas = distinctAreaLabels(
    areaInput.map((a) => a.area),
    raw.city,
    { areaCities: areaInput.map((a) => a.city), cities: areaInput.map((a) => a.city) },
  ).map((a) => a.label)
  const areasShown = areas.slice(0, budget.areas)
  const areasMore = areas.length > areasShown.length ? `+${areas.length - areasShown.length} more` : null
  const location = [...areasShown, ...(areasMore ? [areasMore] : []), city].filter(Boolean).join(', ') || null

  const degrees = degreeLabels(raw.degrees)
    .map((d) => cutAtWord(withoutCnic(displayCase(d)), budget.degreeChars))
    .filter(Boolean)
    .slice(0, budget.degrees)
  const languages = raw.languages.map((l) => l.trim()).filter((l) => l.length > 0)

  let contact: CvContact | null = null
  if (opts.includeContact) {
    const c: CvContact = {}
    const phone = cvPhone(raw.phone)
    const whatsapp = cvPhone(raw.whatsapp)
    const email = clean(raw.email)
    if (phone) c.phone = phone
    if (whatsapp) c.whatsapp = whatsapp
    if (email) c.email = email
    contact = Object.keys(c).length > 0 ? c : null
  }

  const bio = clean(raw.bio)
  const modes = teachingModes(raw.jobTypes, raw.teachingMode)
  const verified = raw.verified === true

  return {
    name: cutAtWord(withoutCnic(raw.fullName), budget.name) || 'Tutor',
    photo,
    photoUrl: photo?.kind === 'photo' ? photo.url : null,
    verified,
    headline: allSubjects.length > 0 || city ? cvTitleLine(allSubjects, city) : clean(raw.headline),
    about: bio ? cutAtWord(alignExperience(bio, raw.experienceYears), budget.about) : null,
    subjects,
    grid: fitted.cells,
    subjectsMore: moreLine(fitted.more),
    degrees,
    experience: experiencePhrase(raw.experienceYears),
    feeLabel: opts.includeFee
      ? feeRangeLabel(raw.feeMinPkr ?? raw.hourlyRatePkr, raw.feeMaxPkr ?? raw.hourlyRatePkr)
      : null,
    city,
    areas: areasShown,
    areasMore,
    location,
    modes,
    teachingMode: modes.length > 0 ? modes.join(', ') : null,
    languages,
    contact,
    footer: verified ? VERIFIED_FOOTER : PLAIN_FOOTER,
    profileUrl: raw.profileUrl,
    completion: raw.completion,
  }
}

// A contact row, resolved once here so the preview and the PDF render the same
// lines. When phone and WhatsApp are the same number they collapse to one
// "Phone & WhatsApp" line rather than printing the same digits twice.
export type CvContactRow = { kind: 'phone' | 'whatsapp' | 'email'; label: string | null; value: string }

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
    rows.push({ kind: 'whatsapp', label: 'Phone & WhatsApp', value: phone })
  } else {
    if (phone) rows.push({ kind: 'phone', label: 'Phone', value: phone })
    if (whatsapp) rows.push({ kind: 'whatsapp', label: 'WhatsApp', value: whatsapp })
  }
  if (email) rows.push({ kind: 'email', label: 'Email', value: email })
  return rows
}

// ---------------------------------------------------------------------------
// The rendered content — every label, in ONE place.
// ---------------------------------------------------------------------------
//
// The Classic and Minimal renderers (preview and PDF) build every visible
// string from cvSections()/cvTextLines(); the Modern layout from cvLayout()
// (lib/cv/layout.ts), which reads the same model. scripts/test-cv.ts checks
// the preview's text against these and renders every PDF.

export type CvIcon = 'book' | 'briefcase' | 'monitor' | 'pin' | 'graduation' | 'phone' | 'mail' | 'wallet' | 'whatsapp'

/** A line in a section. `icon: null` is a plain paragraph (About, Languages). */
export type CvLine = { icon: CvIcon | null; text: string }
export type CvSection = { key: string; heading: string; lines: CvLine[] }

export function cvSections(model: CvModel): CvSection[] {
  const sections: CvSection[] = []

  if (model.about) {
    sections.push({ key: 'about', heading: 'About', lines: [{ icon: null, text: model.about }] })
  }

  if (model.grid.length > 0) {
    sections.push({
      key: 'subjects',
      heading: 'Subjects',
      lines: model.grid.map((g) => ({
        icon: 'book' as const,
        text: g.subjects.length > 0 ? `${g.label}: ${g.subjects.join(', ')}` : g.label,
      })),
    })
    if (model.subjectsMore) sections[sections.length - 1].lines.push({ icon: null, text: model.subjectsMore })
  }

  const teaching: CvLine[] = []
  if (model.experience) teaching.push({ icon: 'briefcase', text: model.experience })
  if (model.feeLabel) teaching.push({ icon: 'wallet', text: model.feeLabel })
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
        icon: (r.kind === 'email' ? 'mail' : r.kind) as CvIcon,
        text: r.label ? `${r.label}: ${r.value}` : r.value,
      })),
    })
  }

  return sections
}

/** The CV's full visible text, in order: header, every section, footer. The
    single source the Classic/Minimal renderers are checked against. */
export function cvTextLines(model: CvModel): string[] {
  const lines: string[] = [model.name]
  if (model.headline) lines.push(model.headline)
  for (const s of cvSections(model)) {
    lines.push(s.heading)
    for (const l of s.lines) lines.push(l.text)
  }
  lines.push(model.footer)
  lines.push(model.profileUrl)
  return lines
}

// ---------------------------------------------------------------- Modern ----
//
// The Modern layout's words, in ONE place: a sidebar (Contact, Teaching mode,
// Areas, the QR caption) and a main column (About, Subjects, Experience,
// Education). The preview and the PDF both render from cvModernLayout().

export const QR_CAPTION = 'Scan to view my profile'

export type CvModernLayout = { sidebar: CvSection[]; main: CvSection[] }

export function cvModernLayout(model: CvModel): CvModernLayout {
  const sidebar: CvSection[] = []
  const contactRows = cvContactRows(model.contact)
  if (contactRows.length > 0) {
    sidebar.push({
      key: 'contact',
      heading: 'Contact',
      lines: contactRows.map((r) => ({
        icon: (r.kind === 'email' ? 'mail' : r.kind) as CvIcon,
        text: r.kind === 'email' ? r.value : `${r.value}${r.kind === 'whatsapp' ? (r.label === 'Phone & WhatsApp' ? ' (Phone & WhatsApp)' : ' (WhatsApp)') : ''}`,
      })),
    })
  }
  if (model.modes.length > 0) {
    sidebar.push({ key: 'mode', heading: 'Teaching mode', lines: model.modes.map((m) => ({ icon: 'monitor' as const, text: m })) })
  }
  const areaLines: CvLine[] = model.areas.map((a) => ({ icon: 'pin' as const, text: a }))
  if (model.areasMore) areaLines.push({ icon: null, text: model.areasMore })
  if (areaLines.length > 0 && model.city) areaLines.push({ icon: null, text: model.city })
  if (areaLines.length === 0 && model.city) areaLines.push({ icon: 'pin', text: model.city })
  if (areaLines.length > 0) sidebar.push({ key: 'areas', heading: 'Areas', lines: areaLines })

  const main: CvSection[] = []
  if (model.about) main.push({ key: 'about', heading: 'About', lines: [{ icon: null, text: model.about }] })
  if (model.grid.length > 0) {
    const lines: CvLine[] = model.grid.map((g) => ({
      icon: 'book' as const,
      text: g.subjects.length > 0 ? `${g.label}: ${g.subjects.join(', ')}` : g.label,
    }))
    if (model.subjectsMore) lines.push({ icon: null, text: model.subjectsMore })
    main.push({ key: 'subjects', heading: 'Subjects', lines })
  }
  const exp: CvLine[] = []
  if (model.experience) exp.push({ icon: 'briefcase', text: model.experience })
  if (model.feeLabel) exp.push({ icon: 'wallet', text: model.feeLabel })
  if (exp.length > 0) main.push({ key: 'experience', heading: 'Experience', lines: exp })
  if (model.degrees.length > 0) {
    main.push({ key: 'education', heading: 'Education', lines: model.degrees.map((d) => ({ icon: 'graduation' as const, text: d })) })
  }
  if (model.languages.length > 0) {
    main.push({ key: 'languages', heading: 'Languages', lines: [{ icon: null, text: model.languages.join(', ') }] })
  }
  return { sidebar, main }
}

/** The Modern CV's full visible text, in reading order. */
export function cvModernTextLines(model: CvModel): string[] {
  const { sidebar, main } = cvModernLayout(model)
  const lines: string[] = []
  for (const s of sidebar) {
    lines.push(s.heading)
    for (const l of s.lines) lines.push(l.text)
  }
  lines.push(QR_CAPTION)
  lines.push(model.name)
  if (model.headline) lines.push(model.headline)
  for (const s of main) {
    lines.push(s.heading)
    for (const l of s.lines) lines.push(l.text)
  }
  lines.push(model.footer)
  lines.push(model.profileUrl)
  return lines
}

/** Every word a template prints, whatever the layout. */
export function cvAllText(model: CvModel, template: CvTemplate): string[] {
  return template === 'modern' ? cvModernTextLines(model) : cvTextLines(model)
}

export type CvTemplate = 'modern' | 'classic' | 'minimal'
export const CV_TEMPLATES: CvTemplate[] = ['modern', 'classic', 'minimal']

export function isCvTemplate(v: string | null | undefined): v is CvTemplate {
  return v === 'modern' || v === 'classic' || v === 'minimal'
}

export type CvAccent = 'navy' | 'green' | 'charcoal'
export const CV_ACCENTS: CvAccent[] = ['navy', 'green', 'charcoal']
export const DEFAULT_ACCENT: CvAccent = 'navy'

export function isCvAccent(v: unknown): v is CvAccent {
  return v === 'navy' || v === 'green' || v === 'charcoal'
}

/** The PDF file name: "<Name>-TutorMint-CV.pdf". */
export function cvFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Tutor'
  return `${safe}-TutorMint-CV.pdf`
}
