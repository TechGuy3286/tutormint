// lib/schoolJobsCore.ts
//
// Which school a post names (owner, 12 Oct 2026) — for the school job hubs
// (/tuition-jobs/school/<slug>) and for JobPosting.hiringOrganization.
//
// A tuition has no "school" column: the posting form's "School or academy name"
// goes into the title ("Post type | Class | School or area | City") and is not
// stored on its own. So the school is read back from the post, two ways:
//
//   1. A KNOWN school — the Admission Test Prep schools in the taxonomy and
//      their search words, plus the short list of chains below — named in the
//      title or the description. Spellings fold to one name ("Beacon House",
//      "Beaconhouse School System" → Beaconhouse School).
//   2. A title segment that reads as a school's own name ("Naveed Majeed
//      Academy", "Beacon Grammar School") — it must carry a school word AND a
//      name beside it, so "ACADEMY" or "School" alone is nobody.
//
// Pure. Nothing is guessed: a post that names no school has no school.

import { slugify } from '@/lib/slugs'

export type KnownSchool = { name: string; aliases: string[] }

/** Chains that are not in the taxonomy but are named in posts and searches. */
export const BUILT_IN_SCHOOLS: KnownSchool[] = [
  { name: 'Beaconhouse School', aliases: ['beaconhouse', 'beacon house'] },
  { name: 'Lahore Grammar School', aliases: ['lgs', 'lahore grammar school'] },
  { name: 'Karachi Grammar School', aliases: ['kgs', 'karachi grammar school'] },
  { name: 'NSSE', aliases: ['nsse'] },
  { name: 'Aitchison College', aliases: ['aitchison'] },
  { name: 'The City School', aliases: ['the city school'] },
  { name: 'Roots International Schools', aliases: ['roots international', 'roots millennium', 'roots school'] },
  { name: 'Allied School', aliases: ['allied school', 'allied schools'] },
  { name: 'The Educators', aliases: ['the educators'] },
  { name: 'Dar-e-Arqam School', aliases: ['dar e arqam', 'dar-e-arqam', 'dar ul arqam'] },
  { name: 'Army Public School', aliases: ['army public school'] },
  { name: 'The Smart School', aliases: ['the smart school'] },
]

/** Taxonomy names that are groups, not one school — never a hub. */
const NOT_A_SCHOOL = new Set(['other', 'cadet colleges'])

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** One dictionary from the taxonomy schools (+ their search words) and the list above. */
export function knownSchools(taxonomy: { name: string; aliases?: string[] }[] = []): KnownSchool[] {
  const byName = new Map<string, KnownSchool>()
  const add = (name: string, aliases: string[]) => {
    const key = norm(name)
    if (!key || NOT_A_SCHOOL.has(key)) return
    const cur = byName.get(key) ?? { name, aliases: [] }
    for (const a of [name, ...aliases]) {
      const n = norm(a)
      // A one-word alias shorter than three letters would match by accident.
      if (n && n.length >= 3 && !cur.aliases.includes(n)) cur.aliases.push(n)
    }
    byName.set(key, cur)
  }
  for (const s of BUILT_IN_SCHOOLS) add(s.name, s.aliases)
  for (const s of taxonomy) add(s.name, s.aliases ?? [])
  return [...byName.values()]
}

// A segment must carry one of these to be a school's name…
const SCHOOL_WORD = /\b(school|schools|college|academy|institute|university|lyceum|educators)\b/i
// …and none of these: a role, a class, a subject list or a street address is
// not a name ("Crescent School Student", "Academy at Badian Road",
// "Prestigious school DHA phase 1").
const NOT_A_NAME = /\b(required|teacher|tutor|tutors|lecturer|grade|level|levels|class|experienced|fresher|apply|staff|student|students|subjects|learning|phase|block|sector|road|town|colony|near|at)\b/i
// Words that describe a school without naming it. A segment made only of these
// ("a prestigious school", "Montessori") names nobody.
const GENERIC = new Set(['school', 'schools', 'college', 'academy', 'the', 'a', 'an', 'in', 'of', 'and', 'private', 'local', 'reputed', 'reputable', 'renowned', 'prestigious', 'famous', 'esteemed', 'top', 'best', 'well', 'known', 'leading', 'our', 'system', 'campus', 'institute', 'girls', 'boys', 'high', 'middle', 'primary', 'secondary', 'public', 'model', 'english', 'medium', 'montessori', 'kindergarten', 'kindergarden'])

/** The school a title names in one of its own segments, as written, or null. */
export function schoolFromTitle(title: string | null | undefined, city?: string | null): string | null {
  const segments = (title ?? '').split('|').map((s) => s.trim()).filter(Boolean)
  // The first segment is the post type ("Female Primary Teacher Required").
  for (const raw of segments.slice(1)) {
    // "The International School, Tooba Masjid, Karachi" → its first part.
    const seg = raw.split(',')[0].trim()
    if (!seg || !SCHOOL_WORD.test(seg) || NOT_A_NAME.test(seg)) continue
    if (city && norm(seg) === norm(city)) continue
    const own = norm(seg).split(' ').filter((w) => w && !GENERIC.has(w))
    if (own.length === 0) continue
    return seg.replace(/\s+/g, ' ')
  }
  return null
}

export type SchoolMatch = { slug: string; name: string }

/**
 * The school this post is a job AT — a known one first, else its title's own.
 *
 * A HOME tuition is never a school's job: "home tutor for a child at LGS" names
 * the child's school, not an employer, so it has no school here. An ONLINE
 * tuition counts only when a school or academy is named in its own title
 * segment (an academy hiring online tutors), never on a passing mention.
 */
export function schoolForJob(
  job: { title: string | null; description?: string | null; city?: string | null; jobTitle?: string | null },
  known: KnownSchool[],
): SchoolMatch | null {
  const type = (job.jobTitle ?? '').trim()
  if (type === 'Home Tutor') return null
  if (type === 'Online Tutor') {
    const seg = schoolFromTitle(job.title, job.city)
    return seg && slugify(seg) ? { slug: slugify(seg), name: titleCaseSchool(seg) } : null
  }
  const hay = ` ${norm(`${job.title ?? ''} ${job.description ?? ''}`)} `
  // Longest alias first, so "lahore grammar school" wins over a shorter word.
  let best: { school: KnownSchool; len: number } | null = null
  for (const school of known) {
    for (const a of school.aliases) {
      if (hay.includes(` ${a} `) && (!best || a.length > best.len)) best = { school, len: a.length }
    }
  }
  if (best) return { slug: slugify(best.school.name), name: best.school.name }
  const own = schoolFromTitle(job.title, job.city)
  if (!own) return null
  const slug = slugify(own)
  return slug ? { slug, name: titleCaseSchool(own) } : null
}

/** "KENT City School" stays; "ACADEMY of x" style shouting is calmed word by word. */
function titleCaseSchool(name: string): string {
  return name
    .split(' ')
    .map((w) => (w.length > 4 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ')
}

/** A school hub is indexable, listed and linked from this many open posts. */
export const SCHOOL_HUB_THRESHOLD = 3

export type SchoolGroup = { slug: string; name: string; jobIds: string[]; cities: string[] }

/** Open posts grouped by the school they name, busiest first. */
export function groupBySchool<T extends { id: string; title: string | null; description?: string | null; city?: string | null; jobTitle?: string | null }>(
  jobs: T[],
  known: KnownSchool[],
): SchoolGroup[] {
  const groups = new Map<string, SchoolGroup & { spell: Map<string, number> }>()
  for (const j of jobs) {
    const m = schoolForJob(j, known)
    if (!m) continue
    const g = groups.get(m.slug) ?? { slug: m.slug, name: m.name, jobIds: [], cities: [], spell: new Map<string, number>() }
    g.jobIds.push(j.id)
    g.spell.set(m.name, (g.spell.get(m.name) ?? 0) + 1)
    const c = (j.city ?? '').trim()
    if (c && !g.cities.some((x) => x.toLowerCase() === c.toLowerCase())) g.cities.push(c)
    groups.set(m.slug, g)
  }
  return [...groups.values()]
    .map(({ spell, ...g }) => ({ ...g, name: [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] }))
    .sort((a, b) => b.jobIds.length - a.jobIds.length || a.name.localeCompare(b.name))
}

export function schoolHubPath(slug: string): string {
  return `/tuition-jobs/school/${slug}`
}

/** "Beaconhouse School" → "Beaconhouse" for the "<School> Teacher Jobs" title. */
export function schoolShortName(name: string): string {
  const short = name.replace(/\s+(school|schools|school system|college)$/i, '').trim()
  // Only when one word is left: "Beaconhouse", "Aitchison" — never "Lahore Grammar".
  return short.length >= 3 && !short.includes(" ") ? short : name
}
