// lib/tuitionTitle.ts
//
// The tuition title (owner, 6 Oct 2026, item 17): "Post type | Class | School
// name | City". PURE — no imports that touch a database or the browser — so the
// composer ("Write this for me"), the tuition page's <title>/og:title and the
// tests all read one function.
//
//   Post type  from the poster's Job Type and gender selections:
//              "Female Home Tutor Required", "Online Tutor Required",
//              "Female O Levels Teacher Required", "Tutor Required" (nothing chosen)
//   Class      the selected grades, collapsed: "Grade 6", "Grade 1–5"
//   School     the school name when given, otherwise the AREA
//   City       never repeated: an area or school that already ends with the city
//              loses that suffix ("Bahria Town Lahore" → "Bahria Town"); an area
//              whose own name carries the city ("North Karachi") stands alone and
//              the separate city segment is dropped.
//
// The visible H1 keeps the full stored title. The <title> and og:title are
// trimmed to 60 characters by `tuitionPageTitle`: drop the school/area segment
// first, then shorten the post type, never cutting a word in half.

import { collapseLevels } from './levelDisplay'
import { areaWithoutCity, areaCarriesCity } from './place'
import { jobType } from './display'

export const TUITION_TITLE_MAX = 60
const BRAND = 'TutorMint'
const SEP = ' | '

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** "female" → "Female"; null for no preference. */
function genderAdjective(gender: string | null | undefined): string | null {
  const g = clean(gender).toLowerCase()
  if (g === 'male') return 'Male'
  if (g === 'female') return 'Female'
  if (g === 'trans') return 'Trans'
  return null
}

/**
 * The post type: [Gender] <Job Type> Required. The Job Type is one of the owner's
 * titles ("Home Tutor", "Online Tutor", "O Levels Teacher" …) stored verbatim; with
 * none chosen it is "Tutor".
 */
export function postType(mode: string | null | undefined, gender: string | null | undefined): string {
  const title = clean(jobType(mode)) || 'Tutor'
  const g = genderAdjective(gender)
  return `${g ? `${g} ` : ''}${title} Required`
}

export type TuitionTitleInput = {
  mode: string | null | undefined
  gender: string | null | undefined
  /** The selected grades (jobs.class_levels). */
  levels: (string | null | undefined)[]
  /** Optional school or academy name. When empty the AREA is used. */
  school?: string | null
  area?: string | null
  city?: string | null
}

/** The title's segments, in order, with empty ones dropped and the city never repeated. */
export function tuitionTitleSegments(input: TuitionTitleInput): string[] {
  const city = clean(input.city)
  const cls = collapseLevels(input.levels ?? [])
  const school = clean(input.school)
  const area = clean(input.area)

  let place = ''
  let dropCity = false
  if (school) {
    // A school named after its city ("Beacon House Lahore") loses the suffix.
    place = areaCarriesCity(school, city) ? school : areaWithoutCity(school, city)
    if (areaCarriesCity(school, city)) dropCity = true
  } else if (area) {
    if (areaCarriesCity(area, city)) {
      place = area
      dropCity = true
    } else {
      place = areaWithoutCity(area, city)
    }
  }
  return [postType(input.mode, input.gender), cls, place, dropCity ? '' : city].filter(Boolean)
}

/** "Female Home Tutor Required | Grade 6 | Johar Town | Lahore". */
export function buildTuitionTitle(input: TuitionTitleInput): string {
  return tuitionTitleSegments(input).join(SEP)
}

/** Shorter forms of a post type, tried in order: drop the gender word, then the
 *  specific title ("O Levels Teacher Required" → "Teacher Required"). */
function shorterPostTypes(pt: string): string[] {
  const out: string[] = []
  const noGender = pt.replace(/^(Male|Female|Trans)\s+/i, '')
  if (noGender !== pt) out.push(noGender)
  const m = noGender.match(/\b(Tutor|Teacher|Lecturer|Principal)\s+Required$/i)
  if (m && noGender !== `${m[1]} Required`) out.push(`${m[1]} Required`)
  return out
}

/** Cut at a word boundary to `max` characters; never mid-word. */
function clampAtWord(text: string, max: number): string {
  const t = clean(text)
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const at = cut.lastIndexOf(' ')
  return (at > 0 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s|,;:—–-]+$/, '')
}

/**
 * The <title> / og:title for a tuition page, 60 characters or fewer.
 *
 * A title that already fits gets " | TutorMint" when that also fits. A pipe
 * title ("Post type | Class | School or area | City") that is too long drops the
 * school/area segment first, then shortens the post type (gender word, then the
 * specific job title). Any other title — the older free-written ones — is cut at
 * a word boundary. Never mid-word.
 */
export function tuitionPageTitle(title: string, max = TUITION_TITLE_MAX): string {
  const base = clean(title)
  const fit = (t: string) => {
    const branded = `${t}${SEP}${BRAND}`
    return branded.length <= max ? branded : t.length <= max ? t : null
  }
  const direct = fit(base)
  if (direct) return direct

  const segs = base.split('|').map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 3) {
    // 1. Drop the school/area (the third of four, or the third of three when the
    //    city segment was dropped because the area carries it).
    const withoutPlace = segs.length >= 4 ? [segs[0], segs[1], ...segs.slice(3)] : [segs[0], segs[1]]
    const a = fit(withoutPlace.join(SEP))
    if (a) return a
    // 2. Shorten the post type.
    for (const shorter of shorterPostTypes(withoutPlace[0])) {
      const b = fit([shorter, ...withoutPlace.slice(1)].join(SEP))
      if (b) return b
    }
    const shortest = shorterPostTypes(withoutPlace[0]).pop() ?? withoutPlace[0]
    return clampAtWord([shortest, ...withoutPlace.slice(1)].join(SEP), max)
  }
  return clampAtWord(base, max)
}
