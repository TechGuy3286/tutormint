// scripts/test-female-pages.ts — /tuition-jobs/<city>/female (owner, 28 Oct 2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isFemaleJob,
  femalePageIndexable,
  femalePageTitle,
  femalePageIntro,
  femaleFooterLinks,
  FEMALE_JOBS_OR,
  FEMALE_PAGE_THRESHOLD,
} from '../lib/femaleJobsCore'
import { hubSitemapEntries, type HubCandidate } from '../lib/sitemapCore'

test('matching: the gender field first, else the whole word "female" with no preference set', () => {
  assert.equal(isFemaleJob({ gender_preference: 'female' }), true)
  assert.equal(isFemaleJob({ gender_preference: 'male', title: 'Female tutor required' }), false)
  assert.equal(isFemaleJob({ gender_preference: 'trans', title: 'female' }), false)
  assert.equal(isFemaleJob({ gender_preference: null, title: 'FEMALE Home Tutor for Grade 4' }), true)
  assert.equal(isFemaleJob({ gender_preference: null, title: 'Home tutor', description: 'A female teacher is preferred.' }), true)
  assert.equal(isFemaleJob({ gender_preference: '', title: 'Home tutor needed' }), false)
  assert.equal(isFemaleJob({ gender_preference: null, title: 'Females only?' }), false, 'whole word only')
  assert.equal(isFemaleJob({ gender_preference: null, title: 'Male tutor' }), false)
  // The list filter is the same rule in PostgREST.
  assert.match(FEMALE_JOBS_OR, /gender_preference\.eq\.female/)
  assert.match(FEMALE_JOBS_OR, /and\(gender_preference\.is\.null,or\(title\.imatch\.\mfemale\M,description\.imatch\.\mfemale\M\)\)/)
})

test('index threshold: 3+ open matching tuitions, the same number as the city pages', () => {
  assert.equal(FEMALE_PAGE_THRESHOLD, 3)
  assert.equal(femalePageIndexable(2), false)
  assert.equal(femalePageIndexable(3), true)
  const src = readFileSync('lib/cityJobs.ts', 'utf8')
  assert.match(src, /export const CITY_PAGE_THRESHOLD = 3/)
  assert.match(src, /isFemaleJob\(r\)/, 'the city page counts with the shared rule')
})

test('sitemap: a female page below 3 is left out, at 3 it is listed', () => {
  const hubs: HubCandidate[] = [
    { path: '/tuition-jobs/lahore/female', count: 3, threshold: 3, lastmod: null },
    { path: '/tuition-jobs/sukkur/female', count: 2, threshold: 3, lastmod: null },
  ]
  const urls = hubSitemapEntries('https://www.tutormint.org', hubs).map((e) => e.url)
  assert.ok(urls.some((u) => u.endsWith('/tuition-jobs/lahore/female')))
  assert.ok(!urls.some((u) => u.endsWith('/tuition-jobs/sukkur/female')))
  // The page's own robots tag reads the same count and threshold.
  const page = readFileSync('app/(site)/tuition-jobs/[city]/[variant]/page.tsx', 'utf8')
  assert.match(page, /v\.count >= CITY_PAGE_THRESHOLD \? \{\} : \{ robots: \{ index: false, follow: true \} \}/)
})

test('title, intro and links', () => {
  assert.equal(femalePageTitle('Lahore'), 'Female Teaching Jobs in Lahore — Home Tuition & School Jobs | TutorMint')
  assert.match(femalePageIntro('Lahore', 5), /^5 open posts ask for a female teacher or tutor in Lahore/)
  assert.match(femalePageIntro('Lahore', 0), /no open posts/)
  const view = readFileSync('components/tuitionJobs/CityJobsView.tsx', 'utf8')
  assert.match(view, /femaleJobs: variant\?\.kind === 'female'/)
  assert.match(view, /\(variant \|\| liveVariants\.length > 0\)/, 'a variant always links back to the city page')
  const pages = [
    { city: 'Karachi', citySlug: 'karachi', variants: [{ kind: 'female', slug: 'female', count: 293 }] },
    { city: 'Sukkur', citySlug: 'sukkur', variants: [{ kind: 'female', slug: 'female', count: 2 }] },
    { city: 'Lahore', citySlug: 'lahore', variants: [{ kind: 'female', slug: 'female', count: 131 }] },
    { city: 'A', citySlug: 'a', variants: [{ kind: 'female', slug: 'female', count: 9 }] },
    { city: 'B', citySlug: 'b', variants: [{ kind: 'female', slug: 'female', count: 8 }] },
    { city: 'C', citySlug: 'c', variants: [{ kind: 'online', slug: 'online', count: 80 }] },
  ]
  const links = femaleFooterLinks(pages)
  assert.deepEqual(links.map((l) => l.href), ['/tuition-jobs/karachi/female', '/tuition-jobs/lahore/female', '/tuition-jobs/a/female', '/tuition-jobs/b/female'])
  assert.ok(readFileSync('components/Footer.tsx', 'utf8').includes('femaleFooterLinks(pages)'))
})
