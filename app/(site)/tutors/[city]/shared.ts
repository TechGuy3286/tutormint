import type { Metadata } from 'next'

import { knownCityBySlug } from '@/lib/cityJobs'
import { seoDescription, seoTitle, socialMeta } from '@/lib/seo'
import { citySegment } from '@/lib/slugs'
import { tutorCityBySlug } from '@/lib/tutorCrawl'
import { cityTutorPageIndexable, cityTutorPath, femaleTutorPageIndexable, type TutorCity } from '@/lib/tutorCrawlCore'

// Shared by /tutors/[city], /tutors/[city]/female and their ?page= twins under
// /qs (PR-11). A city with indexable tutors resolves from them; any other KNOWN
// city renders an empty, noindex page (a known city never 404s); only a city
// nobody ever used is a 404.

export async function resolveTutorCity(citySlug: string): Promise<TutorCity | null> {
  const hit = await tutorCityBySlug(citySlug)
  if (hit) return hit
  const known = await knownCityBySlug(citySlug)
  return known ? { city: known, citySlug: citySegment(known), indexable: 0, female: 0 } : null
}

export function cityTutorsIndexable(city: TutorCity, female: boolean): boolean {
  return female ? femaleTutorPageIndexable(city) : cityTutorPageIndexable(city)
}

export async function cityTutorsMetadata(citySlug: string, female: boolean, page = 1): Promise<Metadata> {
  const city = await resolveTutorCity(citySlug)
  if (!city) return { title: seoTitle('Tutors'), robots: { index: false, follow: true } }
  const heading = female ? `Female tutors in ${city.city}` : `Tutors in ${city.city}`
  const title = seoTitle(page > 1 ? `${heading} — page ${page}` : heading)
  const description = seoDescription(
    `${heading} on TutorMint: browse verified tutor profiles, subjects and levels. Free to browse, no account needed.`,
  )
  const base = cityTutorPath(city.citySlug, female)
  const path = page > 1 ? `${base}?page=${page}` : base
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(cityTutorsIndexable(city, female) ? {} : { robots: { index: false, follow: true } }),
    ...socialMeta({ title, description, path, type: 'website' }),
  }
}

export function pageFrom(raw: string | string[] | undefined): number {
  return Math.max(1, Math.floor(Number(Array.isArray(raw) ? raw[0] : raw) || 1))
}
