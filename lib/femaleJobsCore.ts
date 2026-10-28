// lib/femaleJobsCore.ts
//
// Which open tuitions belong on /tuition-jobs/<city>/female (owner, 28 Oct
// 2026). Pure — the city page count (lib/cityJobs), the list filter
// (lib/jobFeed `femaleJobs`) and the tests read the same rule.
//
// THE RULE:
//   1. gender_preference = 'female' → yes (the form's own field, the main rule);
//   2. a DIFFERENT preference set (male / trans) → no;
//   3. no preference set → yes only when the title or the description holds
//      the whole word "female" (a post written before the field, or a staff
//      post that wrote it in the text only).
// On 28 Oct 2026 rule 3 added no tuition: every open "female" post carried the
// field. It stays so a post that writes it in words is not missed.

export type FemaleJobFacts = {
  gender_preference: string | null
  title?: string | null
  description?: string | null
}

const FEMALE_WORD = /\bfemale\b/i

export function isFemaleJob(j: FemaleJobFacts): boolean {
  const pref = (j.gender_preference ?? '').trim().toLowerCase()
  if (pref === 'female') return true
  if (pref) return false
  return FEMALE_WORD.test(j.title ?? '') || FEMALE_WORD.test(j.description ?? '')
}

/** The same rule as a PostgREST `or` filter (`\m` / `\M` = word edges). */
export const FEMALE_JOBS_OR =
  'gender_preference.eq.female,and(gender_preference.is.null,or(title.imatch.\mfemale\M,description.imatch.\mfemale\M))'

/** The owner's title for the page (28 Oct 2026), emitted as given. */
export function femalePageTitle(city: string): string {
  return `Female Teaching Jobs in ${city} — Home Tuition & School Jobs | TutorMint`
}

export function femalePageHeading(city: string): string {
  return `Female teaching jobs in ${city}`
}

/** A short intro from the page's own count. */
export function femalePageIntro(city: string, count: number): string {
  if (count === 0) return `There are no open posts asking for a female teacher in ${city} right now. New ones are added most days.`
  return `${count} open ${count === 1 ? 'post asks' : 'posts ask'} for a female teacher or tutor in ${city} — home tuitions and school jobs, newest first. Browsing is free and needs no account.`
}

/** The page is indexable (and in the sitemap) from this many open matching tuitions — CITY_PAGE_THRESHOLD. */
export const FEMALE_PAGE_THRESHOLD = 3

export function femalePageIndexable(count: number, threshold = FEMALE_PAGE_THRESHOLD): boolean {
  return count >= threshold
}

type PageLike = { city: string; citySlug: string; variants: { kind: string; slug: string; count: number }[] }

/** Footer links (Tutors column): the busiest cities' female pages, indexable only, at most `max`. */
export function femaleFooterLinks(pages: PageLike[], max = 4, threshold = FEMALE_PAGE_THRESHOLD): { label: string; href: string }[] {
  return pages
    .map((p) => ({ p, v: p.variants.find((v) => v.kind === 'female') }))
    .filter((x) => x.v && femalePageIndexable(x.v.count, threshold))
    .sort((a, b) => b.v!.count - a.v!.count || a.p.city.localeCompare(b.p.city))
    .slice(0, max)
    .map(({ p }) => ({ label: `Female teaching jobs in ${p.city}`, href: `/tuition-jobs/${p.citySlug}/female` }))
}
