// lib/covers/select.ts
//
// The PURE, deterministic selection for a composed blog cover. No next/og, no
// fs, no DB — so it runs in the composer, in the editor if ever needed, and in
// the test runner (scripts/test-covers.ts pins the selection rules). Same
// pure/render split as the social copy vs the social render.
//
// Everything a cover shows is decided HERE from the post, so the same post
// always composes to the same choice of imagery. The composer only paints what
// this returns.

import { COVER_BY_SLUG } from './catalog'

export type CoverBackground = 'white' | 'mint' | 'navy'

export type CoverInput = {
  title: string
  /** A post cluster slug (lib/blog POST_CLUSTERS). */
  cluster: string
  /** The post's city, a display name like "Lahore" (optional). */
  city?: string | null
  /** The post's subject, a display name like "O Level Physics" (optional). */
  subject?: string | null
  audience: 'parents' | 'tutors' | 'both'
  /** Used to alternate the two teacher assets deterministically. */
  slug?: string | null
}

export type CoverSelection = {
  /** seed 0/1/2 -> white / mint / navy. */
  background: CoverBackground
  /** seed 0/1/2 -> one of three layout arrangements. */
  arrangement: 0 | 1 | 2
  /**
   * The "Shuffle" dimension: floor(seed/3) & 1. The three arrangements are the
   * three backgrounds (seed 0..2); Shuffle advances the seed by 3, so the same
   * three grounds come back with the secondary imagery re-rolled — the teacher
   * flips, the motifs swap order, and the composer moves the motif cluster.
   * That is what makes "Shuffle" produce a visibly different trio while every
   * (input, seed) stays deterministic.
   */
  variant: 0 | 1
  /** Title ink: navy on light grounds, white on navy. */
  titleColor: 'navy' | 'white'
  /** Always resolves — the city silhouette or the pakistan-map fallback. */
  citySlug: string
  /** The person on the right, by audience. */
  personSlug: string
  /** One or two motifs (deduped): subject motif, then cluster motif. */
  motifs: string[]
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// City name -> a city asset slug, or pakistan-map when we have no silhouette for
// it (Quetta, Sialkot, Gujranwala) or no city at all.
export function citySilhouette(city: string | null | undefined): string {
  if (city) {
    const s = slugify(city)
    if (COVER_BY_SLUG.has(s) && COVER_BY_SLUG.get(s)!.kind === 'city') return s
  }
  return 'pakistan-map'
}

// Subject name -> a subject motif, matched on keywords, falling back to `book`.
// Order matters: the more specific keyword wins.
const SUBJECT_MOTIFS: { re: RegExp; slug: string }[] = [
  { re: /physics/i, slug: 'physics' },
  { re: /chem/i, slug: 'science' },
  { re: /bio|botany|zoology/i, slug: 'biology' },
  { re: /math|algebra|calculus|geometry|stat/i, slug: 'maths' },
  { re: /comput|\bict\b|programming|coding/i, slug: 'computer' },
  { re: /english|literature|language|urdu|writing/i, slug: 'english' },
  { re: /quran|islam|nazra|tajweed|hifz/i, slug: 'quran' },
  { re: /science/i, slug: 'science' },
]

export function subjectMotif(subject: string | null | undefined): string {
  if (subject) {
    for (const m of SUBJECT_MOTIFS) if (m.re.test(subject)) return m.slug
  }
  return 'book'
}

// Cluster -> a second motif. The keyword rules the brief lists, applied to our
// fixed cluster set; anything they do not name falls to `search`.
const CLUSTER_MOTIFS: Record<string, string> = {
  'cost-hiring': 'wallet',
  'safety-trust': 'shield',
  'boards-exams': 'certificate',
  // subject-guides, city-guides, tutor-career, urdu -> search (the else).
}

export function clusterMotif(cluster: string): string {
  return CLUSTER_MOTIFS[cluster] ?? 'search'
}

export function personFor(audience: CoverInput['audience'], seed: string, variant: number): string {
  if (audience === 'parents') return 'parent-child'
  if (audience === 'tutors') return (hash(seed) + variant) % 2 === 0 ? 'teacher-female' : 'teacher-male'
  return 'student'
}

const BACKGROUNDS: CoverBackground[] = ['white', 'mint', 'navy']

/** The deterministic cover selection for a post at a given seed (0,1,2 = the
 *  three grounds; 3,4,5 = a shuffled trio; and so on). */
export function selectCover(input: CoverInput, seed: number): CoverSelection {
  const n = Math.abs(Math.trunc(seed))
  const s = n % 3 // position in the trio -> the layout arrangement
  const variant = (Math.floor(n / 3) % 2) as 0 | 1
  // Shuffle rotates the ground under every position, so the whole trio visibly
  // changes on Shuffle even for a one-motif, parent-audience post. Seeds 0,1,2
  // are white/mint/navy; the shuffled trio 3,4,5 is mint/navy/white.
  const background = BACKGROUNDS[(s + variant) % 3]
  const sub = subjectMotif(input.subject)
  const clu = clusterMotif(input.cluster)
  // One or two motifs — deduped so a cost-hiring post about Maths does not draw
  // two of the same. Shuffle swaps their order.
  const base = sub === clu ? [sub] : [sub, clu]
  const motifs = variant && base.length > 1 ? [...base].reverse() : base
  return {
    background,
    arrangement: s as 0 | 1 | 2,
    variant,
    titleColor: background === 'navy' ? 'white' : 'navy',
    citySlug: citySilhouette(input.city),
    personSlug: personFor(input.audience, input.slug || input.title || 'x', variant),
    motifs,
  }
}

/** Human alt text: "Illustration: Lahore skyline, a teacher and a search bar." */
export function coverAltText(input: CoverInput, sel: CoverSelection): string {
  const CITY_WORD: Record<string, string> = { 'pakistan-map': 'a map of Pakistan' }
  const cityPhrase =
    sel.citySlug === 'pakistan-map'
      ? 'a map of Pakistan'
      : `the ${titleCity(input.city, sel.citySlug)} skyline`

  const PERSON_WORD: Record<string, string> = {
    'parent-child': 'a parent and child',
    student: 'a student',
    'teacher-male': 'a teacher',
    'teacher-female': 'a teacher',
  }
  const MOTIF_WORD: Record<string, string> = {
    search: 'a search bar',
    book: 'an open book',
    wallet: 'a wallet',
    shield: 'a verification shield',
    certificate: 'a certificate',
    calendar: 'a calendar',
    physics: 'an atom',
    maths: 'drafting tools',
    science: 'a science flask',
    biology: 'a DNA strand',
    english: 'a fountain pen',
    computer: 'a laptop',
    quran: 'a Quran on a stand',
    online: 'an online lesson',
    home: 'a house',
    school: 'a school',
    'grad-cap': 'a graduation cap',
    pin: 'a location pin',
    chat: 'a chat bubble',
    star: 'a star',
    phone: 'a phone',
  }
  const bits = [cityPhrase, PERSON_WORD[sel.personSlug] ?? 'a person', ...sel.motifs.map((m) => MOTIF_WORD[m] ?? m)]
  void CITY_WORD
  // "a, b and c"
  const joined =
    bits.length <= 1 ? bits[0] ?? '' : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`
  return `Illustration: ${joined}.`
}

function titleCity(name: string | null | undefined, slug: string): string {
  if (name && name.trim()) return name.trim()
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}
