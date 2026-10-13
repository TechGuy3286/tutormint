/**
 * scripts/test-seo-search-console.ts — npm run test:seosc
 *
 * The SEO fixes from the Search Console data (owner, 12 Oct 2026):
 *   1. JobPosting — a validator, and a sample online tuition, home tuition,
 *      school job, and one with and one without a budget.
 *   2. Sitemaps — no noindex / paused / closed / redirected / query-string URL
 *      is ever listed, whatever the candidates say.
 *   3. Hubs — the 3-item threshold toggles index / noindex.
 *   4. School hubs — which school a post names.
 *   5. The redirect and the canonical for the plans page.
 *   6. BreadcrumbList on every public page type.
 *   7. The Indexing API queue keeps to 200 a day, new posts first.
 * Pure — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { jobPostingJsonLd, TITLE_MAX, DESCRIPTION_MAX } from '../lib/seo'
import { employmentTypeFor, jobPostingDescription, sentenceCount, validateJobPosting } from '../lib/jobPostingCore'
import {
  cleanEntries,
  hubIndexable,
  hubSitemapEntries,
  sitemapIndexXml,
  tuitionSitemapEntries,
  tutorSitemapEntries,
  urlsetXml,
  SITEMAP_FILES,
} from '../lib/sitemapCore'
import { groupBySchool, knownSchools, schoolForJob, schoolFromTitle, schoolShortName, SCHOOL_HUB_THRESHOLD } from '../lib/schoolJobsCore'
import { hubFaq, hubIntro, hubTitle, hubDescription, landingFaq } from '../lib/hubCopy'
import { browseTutorsMeta, browseTuitionsMeta } from '../lib/browseMeta'
import { indexingKindForStatus, planDrain, INDEXING_DAILY_LIMIT, type QueuedNotice } from '../lib/googleIndexingCore'
import { pauseDueAtMs } from '../lib/tuitionStatus'
import { tuitionPublicState } from '../lib/tuitionStatus'

const BASE = 'https://www.tutormint.org'
const read = (p: string) => fs.readFileSync(p, 'utf8')
const POSTED = new Date(Date.now() - 2 * 86_400_000).toISOString()

type Sample = {
  jobTitle: string
  title: string
  city: string
  area: string | null
  level: string
  subjects: string[]
  budgetMin: number | null
  budgetMax: number | null
  school?: string | null
  free?: string
}

function posting(s: Sample) {
  const url = `${BASE}/tuitions/${s.city.toLowerCase()}/sample-abc123`
  return jobPostingJsonLd({
    url,
    title: s.title,
    description: jobPostingDescription({
      jobTitle: s.jobTitle,
      level: s.level,
      subjects: s.subjects,
      area: s.area,
      city: s.city,
      timing: 'Mon–Fri, 4–6 pm',
      genderWord: 'female',
      budgetLabel: s.budgetMin ? 'Rs 10,000 – 20,000' : null,
      schoolName: s.school ?? null,
      freeText: s.free ?? null,
    }),
    datePosted: POSTED,
    validThrough: new Date(pauseDueAtMs(POSTED)).toISOString(),
    city: s.city,
    area: s.area,
    subjects: s.subjects,
    budgetMin: s.budgetMin,
    budgetMax: s.budgetMax,
    refId: 'TM-2001',
    online: s.jobTitle === 'Online Tutor',
    employmentType: employmentTypeFor({ jobTitle: s.jobTitle, title: s.title, description: s.free ?? null }),
    schoolName: s.school ?? null,
  }) as Record<string, unknown>
}

const HOME: Sample = { jobTitle: 'Home Tutor', title: 'Female Home Tutor Required | Grade 6 | Johar Town | Lahore', city: 'Lahore', area: 'Johar Town', level: 'Grade 6', subjects: ['Mathematics', 'English'], budgetMin: 10000, budgetMax: 19999 }
const ONLINE: Sample = { jobTitle: 'Online Tutor', title: 'Online Tutor Required | O Levels | Karachi', city: 'Karachi', area: null, level: 'O Levels', subjects: ['Physics'], budgetMin: 20000, budgetMax: null }
const SCHOOL: Sample = { jobTitle: 'Primary Teacher', title: 'Female Primary Teacher Required | Grade 4–5 | Naveed Majeed Academy | Lahore', city: 'Lahore', area: 'Manawan', level: 'Grade 4–5', subjects: ['English'], budgetMin: 20000, budgetMax: 30000, school: 'Naveed Majeed Academy' }
const NO_BUDGET: Sample = { ...HOME, budgetMin: null, budgetMax: null }

// --- 1. JobPosting ----------------------------------------------------------

test('JobPosting: a home tuition has every required and recommended field', () => {
  const j = posting(HOME)
  assert.deepEqual(validateJobPosting(j), [])
  assert.equal(j.employmentType, 'PART_TIME')
  assert.equal(j.directApply, true)
  assert.equal((j.identifier as { value: string }).value, 'TM-2001')
  const org = j.hiringOrganization as Record<string, unknown>
  // A private household hires, not TutorMint (owner, 13 Oct 2026).
  assert.equal(org.name, 'Private tutoring client (via TutorMint)')
  assert.ok(org.sameAs && org.url, 'it points at this site')
  assert.equal(org['@id'], undefined, 'it is not the TutorMint Organization node')
  const addr = (j.jobLocation as { address: Record<string, string> }).address
  assert.equal(addr.addressCountry, 'PK')
  assert.equal(addr.addressRegion, 'Punjab')
  assert.equal(addr.addressLocality, 'Lahore')
  assert.equal(addr.streetAddress, 'Johar Town')
  const salary = j.baseSalary as { currency: string; value: { minValue: number; maxValue: number; unitText: string } }
  assert.equal(salary.currency, 'PKR')
  assert.equal(salary.value.unitText, 'MONTH')
  assert.deepEqual([salary.value.minValue, salary.value.maxValue], [10000, 19999])
})

test('JobPosting: validThrough is the 15-day pause, and moves with a resume', () => {
  const j = posting(HOME)
  assert.equal(new Date(j.validThrough as string).getTime(), pauseDueAtMs(POSTED))
  const resumed = new Date().toISOString()
  assert.equal(pauseDueAtMs(resumed) - new Date(resumed).getTime(), 15 * 86_400_000)
})

test('JobPosting: an online tuition is TELECOMMUTE for applicants in Pakistan', () => {
  const j = posting(ONLINE)
  assert.deepEqual(validateJobPosting(j), [])
  assert.equal(j.jobLocationType, 'TELECOMMUTE')
  assert.deepEqual(j.applicantLocationRequirements, { '@type': 'Country', name: 'Pakistan' })
  // A one-sided band ("over Rs 20,000") is one figure, never an invented top.
  const v = (j.baseSalary as { value: { minValue: number; maxValue: number } }).value
  assert.deepEqual([v.minValue, v.maxValue], [20000, 20000])
})

test('JobPosting: a school job names its school and claims no employment type it was not told', () => {
  const j = posting(SCHOOL)
  assert.deepEqual((j.hiringOrganization as Record<string, unknown>), { '@type': 'Organization', name: 'Naveed Majeed Academy' })
  assert.equal(j.employmentType, undefined, 'unknown for a school post → left out')
  const problems = validateJobPosting(j)
  assert.deepEqual(problems.filter((p) => p.level === 'required'), [])
  assert.deepEqual(problems.map((p) => p.field), ['employmentType'], 'the only gap is the recommended field we will not guess')
  assert.equal(employmentTypeFor({ jobTitle: 'Primary Teacher', description: 'Full time position, 8 to 2.' }), 'FULL_TIME')
  assert.equal(employmentTypeFor({ jobTitle: 'Visiting Teacher' }), 'PART_TIME')
  assert.equal(employmentTypeFor({ jobTitle: 'College Lecturer', description: 'One year contract.' }), 'CONTRACTOR')
})

test('JobPosting: no budget → no baseSalary (a recommended gap), never a half-filled one', () => {
  const j = posting(NO_BUDGET)
  assert.equal(j.baseSalary, undefined)
  const problems = validateJobPosting(j)
  assert.deepEqual(problems.map((p) => `${p.level}:${p.field}`), ['recommended:baseSalary'])
  assert.deepEqual(validateJobPosting(posting(HOME)).filter((p) => p.field === 'baseSalary'), [])
})

test('JobPosting: the description is 2+ plain sentences built from the fields', () => {
  const d = jobPostingDescription({ jobTitle: 'Home Tutor', level: 'Grade 6', subjects: ['Mathematics', 'English'], area: 'Johar Town', city: 'Lahore', timing: 'Mon–Fri, 4–6 pm', genderWord: 'female', budgetLabel: 'Rs 10,000 – 20,000' })
  assert.ok(sentenceCount(d) >= 2)
  for (const part of ['Home Tutor', 'Grade 6', 'Mathematics and English', 'Johar Town, Lahore', 'Mon–Fri, 4–6 pm', 'female teacher is preferred', 'home tuition', 'Rs 10,000 – 20,000 a month']) {
    assert.ok(d.includes(part), `the description says "${part}"`)
  }
  assert.ok(!/<[a-z]/i.test(d), 'plain text, no markup')
  // With nothing but a title and a city it is still two honest sentences.
  const thin = jobPostingDescription({ jobTitle: 'Online Tutor', level: null, subjects: [], area: null, city: 'Karachi', timing: null, genderWord: null, budgetLabel: null })
  assert.ok(sentenceCount(thin) >= 2)
  assert.ok(!/undefined|null/.test(thin))
  // What the poster wrote follows the built sentences.
  assert.ok(jobPostingDescription({ jobTitle: 'Home Tutor', level: null, subjects: [], area: null, city: 'Lahore', timing: null, genderWord: null, budgetLabel: null, freeText: 'Child needs help with fractions.' }).endsWith('Child needs help with fractions.'))
})

test('JobPosting validator: catches what Google would', () => {
  const good = posting(HOME)
  const fields = (j: unknown) => validateJobPosting(j).map((p) => `${p.level}:${p.field}`)
  assert.ok(fields({ ...good, title: '' }).includes('required:title'))
  assert.ok(fields({ ...good, description: 'Tutor needed.' }).includes('required:description'))
  assert.ok(fields({ ...good, datePosted: 'yesterday' }).includes('required:datePosted'))
  assert.ok(fields({ ...good, hiringOrganization: { '@type': 'Organization' } }).includes('required:hiringOrganization'))
  assert.ok(fields({ ...good, jobLocation: undefined }).includes('required:jobLocation'))
  assert.ok(fields({ ...good, validThrough: new Date(Date.now() - 1000).toISOString() }).includes('required:validThrough'))
  assert.ok(fields({ ...good, employmentType: 'FREELANCE' }).includes('required:employmentType'))
  assert.ok(fields({ ...good, baseSalary: { '@type': 'MonetaryAmount', currency: 'PKR', value: { '@type': 'QuantitativeValue', minValue: 5000, unitText: 'MONTH' } } }).includes('required:baseSalary.value'))
  assert.ok(fields({ ...good, identifier: undefined }).includes('recommended:identifier'))
  assert.ok(fields({ ...good, directApply: undefined }).includes('recommended:directApply'))
})

test('a paused, closed or hired tuition emits no JobPosting and is noindex', () => {
  for (const s of ['paused', 'closed', 'hired']) {
    const st = tuitionPublicState(s)
    assert.equal(st.emitJobPosting, false)
    assert.equal(st.indexable, false)
    assert.equal(st.inSitemap, false)
  }
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(page, /!fixture && state\.emitJobPosting && !repeatOf &&/, 'the page emits JobPosting only through the state rule')
})

// --- 2. Sitemaps ------------------------------------------------------------

test('sitemap: a noindex, paused, closed, merged or thin tuition is never listed', () => {
  const out = tuitionSitemapEntries(BASE, [
    { path: '/tuitions/lahore/open-aaaaaa', status: 'open', isFixture: false, descriptionLength: 200 },
    { path: '/tuitions/lahore/paused-bbbbbb', status: 'paused', isFixture: false, descriptionLength: 200 },
    { path: '/tuitions/lahore/closed-cccccc', status: 'closed', isFixture: false, descriptionLength: 200 },
    { path: '/tuitions/lahore/hired-dddddd', status: 'hired', isFixture: false, descriptionLength: 200 },
    { path: '/tuitions/lahore/fixture-eeeeee', status: 'open', isFixture: true, descriptionLength: 200 },
    { path: '/tuitions/lahore/thin-ffffff', status: 'open', isFixture: false, descriptionLength: 12 },
    { path: '/tuitions/lahore/merged-gggggg', status: 'open', isFixture: false, descriptionLength: 200, merged: true },
  ])
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/tuitions/lahore/open-aaaaaa`])
})

test('sitemap: only paid + approved tutor profiles are listed', () => {
  const ok = { feePaid: true, cnicApproved: true, profilePicApproved: true, selfieApproved: true }
  const out = tutorSitemapEntries(BASE, [
    { path: '/tutor/ok', ...ok },
    { path: '/tutor/unpaid', ...ok, feePaid: false },
    { path: '/tutor/no-cnic', ...ok, cnicApproved: false },
    { path: '/tutor/no-photo', ...ok, profilePicApproved: false },
    { path: '/tutor/no-selfie', ...ok, selfieApproved: false },
    { path: '/tutor/seed', ...ok, isSeed: true },
    { path: '/tutor/review', ...ok, underReview: true },
  ])
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/tutor/ok`])
})

test('sitemap: query strings, other hosts, relative addresses and duplicates are dropped', () => {
  const out = cleanEntries(
    [
      { url: `${BASE}/membership-plans` },
      { url: `${BASE}/membership-plans?for=tutors&plan=premium` },
      { url: `${BASE}/tutor/packages?plan=featured` },
      { url: `${BASE}/browse/tutors?city=Lahore` },
      { url: `${BASE}/faq#refunds` },
      { url: 'https://tutormint.org/about' },
      { url: '/about' },
      { url: `${BASE}/membership-plans` },
    ],
    BASE,
  )
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/membership-plans`])
})

test('sitemap: /sitemap.xml is an index of the four files, and the old single file is gone', () => {
  assert.deepEqual([...SITEMAP_FILES], ['tuitions', 'tutors', 'pages', 'blog'])
  const xml = sitemapIndexXml(BASE, SITEMAP_FILES.map((file) => ({ file })))
  assert.match(xml, /<sitemapindex /)
  for (const f of SITEMAP_FILES) {
    assert.ok(xml.includes(`<loc>${BASE}/sitemap-${f}.xml</loc>`))
    assert.ok(fs.existsSync(`app/sitemap-${f}.xml/route.ts`), `the ${f} file has a route`)
  }
  assert.ok(fs.existsSync('app/sitemap.xml/route.ts'))
  assert.ok(!fs.existsSync('app/sitemap.ts'), 'no second /sitemap.xml')
  const set = urlsetXml([{ url: `${BASE}/a&b`, lastmod: '2026-10-12T00:00:00Z', priority: 0.6 }])
  assert.ok(set.includes('<loc>https://www.tutormint.org/a&amp;b</loc>'))
  assert.ok(set.includes('<lastmod>2026-10-12T00:00:00.000Z</lastmod>'))
  assert.match(read('app/robots.ts'), /sitemap: `\$\{BASE\}\/sitemap\.xml`/)
})

test('sitemap: the loaders only list through the shared rules, and parent cards never', () => {
  const src = read('lib/sitemaps.ts')
  assert.match(src, /tuitionSitemapEntries\(/)
  assert.match(src, /tutorSitemapEntries\(/)
  assert.match(src, /hubSitemapEntries\(/)
  assert.match(src, /rpc\('indexable_job_slugs'\)/)
  assert.match(src, /rpc\('listed_tutor_slugs'\)/)
  assert.ok(!/\/parent\//.test(src), 'no /parent/<id> address is ever built')
  assert.ok(!/\/login|\/register|\/pay\//.test(src))
  const parent = read('app/(site)/parent/[id]/page.tsx')
  assert.ok((parent.match(/robots: \{ index: false, follow: false \}/g) ?? []).length >= 2, '/parent/<id> stays noindex')
})

// --- 3. Hubs ----------------------------------------------------------------

test('hub threshold: 3 live items is indexable and listed; 2 is noindex and unlisted', () => {
  assert.equal(hubIndexable({ count: 3, threshold: 3 }), true)
  assert.equal(hubIndexable({ count: 2, threshold: 3 }), false)
  assert.equal(hubIndexable({ count: 9, threshold: 3, overlap: true }), false, 'a near-duplicate is noindex whatever its count')
  const out = hubSitemapEntries(BASE, [
    { path: '/tuition-jobs/lahore/bahria-town', count: 3, threshold: 3 },
    { path: '/tuition-jobs/lahore/mazang', count: 2, threshold: 3 },
    { path: '/tuition-jobs/school/beaconhouse-school', count: 1, threshold: SCHOOL_HUB_THRESHOLD },
    { path: '/tutors/lahore/grade-7-mathematics', count: 0, threshold: 3 },
    { path: '/tuitions/lahore/grade-7-mathematics', count: 5, threshold: 3, overlap: true },
  ])
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/tuition-jobs/lahore/bahria-town`])
})

test('hub pages read the same threshold for robots, the sitemap and their links', () => {
  const variant = read('app/(site)/tuition-jobs/[city]/[variant]/page.tsx')
  assert.match(variant, /v\.count >= CITY_PAGE_THRESHOLD \? \{\} : \{ robots: \{ index: false, follow: true \} \}/)
  const school = read('app/(site)/tuition-jobs/school/[school]/page.tsx')
  assert.match(school, /count >= SCHOOL_HUB_THRESHOLD \? \{\} : \{ robots: \{ index: false, follow: true \} \}/)
  // A tutor landing page counts VERIFIED tutors, not listed ones.
  const landing = read('lib/landing.ts')
  assert.match(landing, /if \(combo\.kind === 'tutors'\) return \(combo\.verified \?\? 0\) >= LANDING_THRESHOLD/)
  assert.match(landing, /\.filter\(landingIndexable\)/, 'link blocks and the sitemap list only indexable pages')
  // Link blocks never point at a hub below the threshold.
  assert.match(read('components/tuitionJobs/CityJobsView.tsx'), /v\.count >= CITY_PAGE_THRESHOLD && v\.slug !== variant\?\.slug/)
  assert.match(read('lib/cityJobs.ts'), /x\.count >= CITY_PAGE_THRESHOLD\)/)
  assert.match(read('components/landing/PopularLandingLinks.tsx'), /liveLandingPages\(\)/)
})

test('hub copy: intro, three FAQs and a title from the page data, within the limits', () => {
  const f = { count: 7, areas: ['Bahria Town', 'DHA'], levels: ['Grade 6–8', 'O Levels'], jobTypes: ['Home Tutor', 'Primary Teacher'], budgetMin: 10000, budgetMax: 30000 }
  const intro = hubIntro('area', 'Bahria Town, Lahore', f)
  assert.ok(intro.includes('7 open posts') && intro.includes('Grade 6–8') && intro.includes('Rs 10,000'))
  assert.ok(sentenceCount(intro) >= 2 && sentenceCount(intro) <= 4)
  const faq = hubFaq('area', 'Bahria Town, Lahore', f)
  assert.equal(faq.length, 3)
  assert.ok(faq[0].a.includes('7 posts are open'))
  for (const kind of ['city', 'area', 'female', 'online', 'school'] as const) {
    assert.equal(hubFaq(kind, 'Lahore', f).length, 3)
    assert.ok(hubTitle(kind, 'Lahore', 7).length <= TITLE_MAX)
    assert.ok(hubDescription(kind, 'Lahore', f).length <= DESCRIPTION_MAX)
  }
  assert.equal(hubTitle('area', 'Bahria Town, Lahore', 7), 'Teaching Jobs in Bahria Town, Lahore – 7 Open | TutorMint')
  assert.equal(hubTitle('school', 'Beaconhouse School', 4, 'Beaconhouse'), 'Beaconhouse Teacher Jobs – 4 Open Vacancies | TutorMint')
  assert.ok(hubTitle('area', 'Ghazi Salahuddin Road Muhammed Ali Society, Karachi', 12).length <= TITLE_MAX)
  // No plan price and no promise of work anywhere in the hub copy.
  const all = [intro, ...faq.flatMap((x) => [x.q, x.a]), ...landingFaq('tutors', 'O Levels Physics', 'Lahore', { count: 4, feeMin: null, feeMax: null, areas: [] }).flatMap((x) => [x.q, x.a])].join(' ')
  assert.ok(!/Rs 199|Rs 499|Rs 999|guarantee/i.test(all))
  assert.equal(landingFaq('tuitions', 'Grade 5 English', 'Karachi', { count: 3, feeMin: 5000, feeMax: 9000, areas: ['Clifton'] }).length, 3)
})

// --- 4. School hubs ---------------------------------------------------------

test('school: a known school is found by any spelling; a title names its own', () => {
  const known = knownSchools([{ name: 'Beaconhouse School' }, { name: 'Lahore Grammar School' }, { name: 'NSSE' }, { name: 'Other' }, { name: 'Cadet Colleges' }])
  assert.equal(schoolForJob({ title: 'O Levels English Teacher Required | O Levels | Beaconhouse School | Lahore' }, known)?.slug, 'beaconhouse-school')
  assert.equal(schoolForJob({ title: 'Teacher Required | Grade 5 | Lahore', description: 'Beacon House School System needs a class teacher.' }, known)?.name, 'Beaconhouse School')
  assert.equal(schoolForJob({ title: 'Maths Teacher Required | LGS | Lahore' }, known)?.name, 'Lahore Grammar School')
  assert.equal(schoolForJob({ title: 'Female Teacher Required | Grade 7 | Beacon Grammar School | Lahore' }, known)?.name, 'Beacon Grammar School', '"Beacon Grammar" is not Beaconhouse')
  assert.equal(schoolForJob({ title: 'Female Primary Teacher Required | Grade 1–3 | Naveed Majeed Academy | Lahore' }, known)?.slug, 'naveed-majeed-academy')
  assert.equal(schoolFromTitle('Female Middle School Teacher Required | Grade 8 | The International School, Tooba Masjid, Karachi'), 'The International School')
  // No school named → no school. A bare "ACADEMY", an area or a role is nobody.
  assert.equal(schoolForJob({ title: 'College Lecturer Required | Mathematics | ACADEMY | Lahore' }, known), null)
  assert.equal(schoolForJob({ title: 'Female Primary Teacher Required | Grade 1–5 | North Nazimabad | Karachi' }, known), null)
  assert.equal(schoolForJob({ title: 'Female Home Tutor Required | Grade 6 | Johar Town | Lahore', description: 'A home tutor for my child.' }, known), null)
  // A HOME tuition for a child who goes to a school is not a job at that school.
  assert.equal(schoolForJob({ jobTitle: 'Home Tutor', title: 'O-Levels Tutor Required | Lahore Grammar School' }, known), null)
  assert.equal(schoolForJob({ jobTitle: 'Home Tutor', title: 'Female Tutor Required in DHA Lahore for Grade 7&8 Cambridge (LGS)' }, known), null)
  // An academy hiring online tutors names itself in its own title segment.
  assert.equal(schoolForJob({ jobTitle: 'Online Tutor', title: 'Online Tutor Required | Grade 1–5 | Al Rafiq Horizon Academy, Karachi' }, known)?.slug, 'al-rafiq-horizon-academy')
  assert.equal(schoolForJob({ jobTitle: 'Online Tutor', title: 'Online Tutor Required | O Levels | Karachi', description: 'Student is at Beaconhouse.' }, known), null)
  assert.equal(schoolForJob({ title: 'High School Teacher Required | Grade 9 | Lahore' }, known), null)
  assert.ok(!known.some((k) => k.name === 'Other' || k.name === 'Cadet Colleges'))
  assert.equal(schoolShortName('Beaconhouse School'), 'Beaconhouse')
  assert.equal(schoolShortName('Lahore Grammar School'), 'Lahore Grammar School')
  assert.equal(schoolShortName('NSSE'), 'NSSE')
})

test('school: posts group by school, busiest first, and need 3 to be a hub', () => {
  const known = knownSchools([])
  const jobs = [
    { id: '1', title: 'A | Grade 1 | Naveed Majeed Academy | Lahore', city: 'Lahore' },
    { id: '2', title: 'B | Grade 2 | Naveed Majeed Academy', city: 'Lahore' },
    { id: '3', title: 'C | Grade 3 | Naveed Majeed Academy | Lahore', city: 'lahore' },
    { id: '4', title: 'D | Grade 4 | Beacon Grammar School | Lahore', city: 'Lahore' },
    { id: '5', title: 'E | Grade 5 | Johar Town | Lahore', city: 'Lahore' },
  ]
  const groups = groupBySchool(jobs, known)
  assert.deepEqual(groups.map((g) => [g.slug, g.jobIds.length]), [['naveed-majeed-academy', 3], ['beacon-grammar-school', 1]])
  assert.deepEqual(groups[0].cities, ['Lahore'])
  assert.deepEqual(groups.filter((g) => g.jobIds.length >= SCHOOL_HUB_THRESHOLD).map((g) => g.slug), ['naveed-majeed-academy'])
})

// --- 5. Redirect and canonical ----------------------------------------------

test('the plans page: clean address indexable with a canonical; old addresses 301 to it', () => {
  const page = read('app/(site)/membership-plans/page.tsx')
  assert.match(page, /alternates: \{ canonical: '\/membership-plans' \}/)
  assert.ok(!/robots: \{ index: false/.test(page), 'the clean address is indexable')
  const proxy = read('proxy.ts')
  assert.match(proxy, /pathname === '\/tutor\/packages' \|\| request\.nextUrl\.pathname === '\/parent\/packages'/)
  assert.match(proxy, /target\.pathname = '\/membership-plans'\s+target\.search = ''\s+return NextResponse\.redirect\(target, 301\)/)
  const cfg = read('next.config.ts')
  assert.ok(!/source: '\/tutor\/packages'/.test(cfg), 'no query-carrying redirect is left in next.config')
  assert.match(read('lib/sitemaps.ts'), /\$\{BASE\}\/membership-plans`/)
})

test('no internal link points at an address that redirects', () => {
  const stubs = ['/tutor/packages', '/parent/packages', '/tutor/register', '/tutor/login', '/parent/login', '/signup', '/packages']
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name)) {
        const src = read(p)
        for (const s of stubs) {
          if (new RegExp(`(href=|router\\.(push|replace)\\()["'{\`]*${s.replace(/\//g, '\\/')}["'\`?]`).test(src)) hits.push(`${p} → ${s}`)
        }
      }
    }
  }
  walk('app')
  walk('components')
  assert.deepEqual(hits, [])
})

// --- 6. Breadcrumbs ---------------------------------------------------------

test('BreadcrumbList on every public page type', () => {
  const crumbs = read('components/Breadcrumbs.tsx')
  assert.match(crumbs, /'@type': 'BreadcrumbList'/)
  assert.match(crumbs, /\{ label: 'Home', href: '\/' \}/, 'Home is always the first crumb')
  const pages: Record<string, string> = {
    'tuition page': 'app/(site)/tuitions/[city]/[slug]/page.tsx',
    'tutor profile': 'app/(site)/tutor/[slug]/page.tsx',
    'city and area hub': 'components/tuitionJobs/CityJobsView.tsx',
    'school hub': 'app/(site)/tuition-jobs/school/[school]/page.tsx',
    'landing hub': 'components/landing/LandingView.tsx',
    'blog post': 'app/(site)/blog/[slug]/page.tsx',
    'browse tutors': 'app/(site)/browse/tutors/page.tsx',
    'browse tuitions': 'app/(site)/browse/tuitions/page.tsx',
  }
  for (const [name, file] of Object.entries(pages)) assert.match(read(file), /<Breadcrumbs\b/, `${name} renders the breadcrumb`)
  // Home › Tuition jobs › City › Title, and Home › Tutors › City › Name.
  const tuition = read(pages['tuition page'])
  assert.match(tuition, /\{ label: 'Tuition jobs', href: '\/browse\/tuitions' \}/)
  assert.match(tuition, /label: job\.city,/)
  const tutor = read(pages['tutor profile'])
  assert.match(tutor, /\{ label: 'Tutors', href: '\/browse\/tutors' \}/)
  assert.match(tutor, /label: tutor\.city, href:/)
})

// --- 7. Browse titles -------------------------------------------------------

test('browse titles and descriptions: the owner wording, cities, "free to join, no commission"', () => {
  const tutors = browseTutorsMeta(null, '')
  assert.equal(tutors.title, 'Find Verified Home & Online Tutors in Pakistan | TutorMint')
  assert.ok(tutors.title.length <= TITLE_MAX)
  const jobs = browseTuitionsMeta(null, '')
  assert.equal(jobs.title, 'Tuition & Teaching Jobs in Pakistan – Updated Daily | TutorMint')
  assert.ok(jobs.title.length <= 64, 'about 60')
  for (const m of [tutors, jobs, browseTutorsMeta('O Levels Physics', 'Lahore'), browseTuitionsMeta(null, 'Rawalpindi'), browseTuitionsMeta('Pre Nursery / Play Group / KG I Phonics', 'Faisalabad')]) {
    assert.ok(m.description.length <= DESCRIPTION_MAX, m.description)
    assert.match(m.description, /[Ff]ree to join, no commission/)
  }
  for (const c of ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi']) {
    assert.ok(tutors.description.includes(c) && jobs.description.includes(c))
  }
  assert.ok(browseTuitionsMeta(null, 'Rawalpindi').title.length <= TITLE_MAX)
})

// --- 8. Indexing API queue --------------------------------------------------

const notice = (id: number, url: string, kind: QueuedNotice['kind'], minute: number): QueuedNotice => ({
  id,
  url: `${BASE}/tuitions/lahore/${url}`,
  kind,
  created_at: new Date(Date.UTC(2026, 9, 12, 0, minute)).toISOString(),
})

test('indexing: paused, closed and hired are URL_DELETED; open is URL_UPDATED', () => {
  assert.equal(indexingKindForStatus('open'), 'URL_UPDATED')
  for (const s of ['paused', 'closed', 'hired']) assert.equal(indexingKindForStatus(s), 'URL_DELETED')
  assert.match(read('lib/tuitionPause.ts'), /enqueueIndexing\(urls, 'URL_DELETED'\)/, 'the 7-day sweep')
  assert.match(read('lib/selfPause.ts'), /queueIndexingDelete\(j\)/, "the member's own pause")
  const jobs = read('lib/jobs.ts')
  assert.equal((jobs.match(/queueIndexingDelete\(/g) ?? []).length, 2, 'close and hire')
  assert.match(read('app/api/admin/jobs/action/route.ts'), /queueIndexingForStatus\(/)
  assert.match(read('lib/pausedTuitions.ts'), /queueIndexingUpdate\(/, 'a resume is URL_UPDATED')
})

test('indexing: never more than 200 a day, and never past what is left today', () => {
  const pending = Array.from({ length: 450 }, (_, i) => notice(i + 1, `t${i}`, 'URL_DELETED', i % 50))
  assert.equal(INDEXING_DAILY_LIMIT, 200)
  assert.equal(planDrain(pending, 0).send.length, 200)
  assert.equal(planDrain(pending, 150).send.length, 50)
  assert.equal(planDrain(pending, 200).send.length, 0)
  assert.equal(planDrain(pending, 260).send.length, 0, 'already over: nothing more goes')
  assert.equal(planDrain(pending, 0, 5).send.length, 5, 'a user action sends a few at most')
  assert.equal(planDrain(pending, 198, 5).send.length, 2)
  assert.equal(planDrain(pending, 0, 1000).send.length, 200, 'a caller cannot raise the limit')
})

test('indexing: new posts and resumes go before removals, oldest first within each', () => {
  const plan = planDrain(
    [notice(1, 'old-paused', 'URL_DELETED', 1), notice(2, 'older-closed', 'URL_DELETED', 0), notice(3, 'new-post', 'URL_UPDATED', 30), notice(4, 'resumed', 'URL_UPDATED', 20)],
    197,
  )
  assert.deepEqual(plan.send.map((n) => n.id), [4, 3, 2], 'both updates first, then the oldest removal; the fourth waits')
  assert.equal(plan.waiting, 4)
})

test('indexing: one notice per address — only the newest is sent', () => {
  const plan = planDrain([notice(1, 'same', 'URL_DELETED', 1), notice(2, 'same', 'URL_UPDATED', 5), notice(3, 'other', 'URL_DELETED', 2), notice(4, 'other', 'URL_DELETED', 9)], 0)
  assert.deepEqual(plan.send.map((n) => n.id), [2, 4], 'paused then resumed → it is live; the repeat removal is sent once')
  assert.deepEqual(plan.superseded.sort(), [1, 3])
  const src = read('lib/googleIndexing.ts')
  assert.match(src, /planDrain\(pending, sentToday, max\)/, 'the drain sends only what the plan allows')
  assert.match(src, /\.gte\('sent_at', utcDayStart\(\)\)/, 'a superseded notice (1970) is never counted as sent today')
})
