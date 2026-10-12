// lib/browseMeta.ts
//
// The <title> and meta description of the two Browse pages (owner, 12 Oct
// 2026). Search Console showed /browse/tutors at position 2.5 with 109
// impressions and no clicks: the snippet said nothing a searcher wanted. The
// title now says what the page offers, and the description names the cities and
// the two things that set the site apart — free to join, no commission.
//
// Pure, so the page and the test read the same strings. Titles stay at about
// 60 characters and descriptions under 155 (lib/seo fitTitle / seoDescription).

import { fitTitle, seoDescription, BRAND } from '@/lib/seo'

/** The four cities pinned first in location_cities — where the listings are. */
const CITIES = 'Karachi, Lahore, Islamabad and Rawalpindi'

export function browseTutorsMeta(subject: string | null, city: string): { title: string; description: string } {
  const where = city ? city : 'Pakistan'
  const title = subject
    ? fitTitle([`Find ${subject} Tutors in ${where} | ${BRAND}`, `${subject} Tutors in ${where} | ${BRAND}`, `${subject} Tutors in ${where}`])
    : fitTitle([`Find Verified Home & Online Tutors in ${where} | ${BRAND}`, `Home & Online Tutors in ${where} | ${BRAND}`, `Tutors in ${where} | ${BRAND}`])
  const what = subject ? `${subject} tutors` : 'home and online tutors'
  const description = seoDescription(
    city
      ? `Find ${what} in ${city}. Verified tutors are listed first. Free to join, no commission — message a tutor directly on TutorMint.`
      : `Find ${what} in ${CITIES}. Verified tutors are listed first. Free to join, no commission.`,
  )
  return { title, description }
}

export function browseTuitionsMeta(subject: string | null, city: string): { title: string; description: string } {
  const where = city ? city : 'Pakistan'
  const title = subject
    ? fitTitle([`${subject} Tuition Jobs in ${where} | ${BRAND}`, `${subject} Tuition Jobs in ${where}`])
    : city
      ? fitTitle([`Tuition & Teaching Jobs in ${city} – Updated Daily | ${BRAND}`, `Tuition & Teaching Jobs in ${city} | ${BRAND}`, `Tuition & Teaching Jobs in ${city}`])
      : // The owner's own wording, kept whole (63 characters — "about 60").
        `Tuition & Teaching Jobs in Pakistan – Updated Daily | ${BRAND}`
  const what = subject ? `${subject} tuition jobs` : 'Home tuition, online tuition and school teaching jobs'
  const description = seoDescription(
    city
      ? `${what} in ${city}, updated daily. Free to join, no commission — apply on TutorMint.`
      : `${what} in ${CITIES}, updated daily. Free to join, no commission.`,
  )
  return { title, description }
}
