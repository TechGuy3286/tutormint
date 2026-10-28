/**
 * scripts/test-site-identity.ts — npm run test:siteidentity
 *
 * "Tell Google clearly what TutorMint is" (owner, 13 Oct 2026). Builds the
 * JSON-LD of every public page type from its builder and checks its shape:
 * valid JSON, a schema.org type we mean to emit, the required fields, NO
 * AggregateRating / Review anywhere, and no phone, email, CNIC, fee or address
 * on a tutor's Person. Also: one source of identity, Organization + WebSite
 * emitted once (by the site chrome), and FAQ data = the visible FAQ text.
 * Pure — no network, no database. The live check is `npm run check:jsonld`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  aboutPageJsonLd,
  articleJsonLd,
  collectionPageJsonLd,
  COLLECTION_ITEMS_MAX,
  faqJsonLd,
  jobPostingJsonLd,
  jsonLdScript,
  siteGraphJsonLd,
  tutorProfileJsonLd,
  PRIVATE_CLIENT_NAME,
} from '../lib/seo'
import {
  HOME_H1,
  HOME_TITLE,
  llmsText,
  ORGANIZATION_ID,
  SITE_DESCRIPTION,
  SITE_FEATURES,
  SITE_TAGLINE,
  WEBSITE_ID,
} from '../lib/siteIdentity'
import { FAQ_GROUPS, FAQ_ITEMS } from '../lib/faqContent'
import { tutorMetaDescription } from '../lib/tutorMeta'
import type { Company } from '../lib/company'

const COMPANY: Company = {
  legalName: 'Tutor Mint (Private) Limited',
  shortName: 'Tutor Mint (Pvt) Ltd',
  brand: 'TutorMint',
  address: '4th Floor, 37-M, Civic Center, Model Town, Lahore, Punjab, Pakistan',
  email: 'support@tutormint.org',
  regNo: '0353636',
  ntn: 'J833612',
  regNoPending: false,
  ntnPending: false,
}

type Node = Record<string, unknown>
const ALLOWED = new Set([
  'Organization', 'WebSite', 'AboutPage', 'FAQPage', 'ProfilePage', 'Person', 'JobPosting',
  'CollectionPage', 'ItemList', 'Article', 'BreadcrumbList',
])

/** Through the same serialiser the pages use, then parsed back. */
function emitted(data: unknown): Node[] {
  const parsed = JSON.parse(jsonLdScript(data).__html) as Node
  assert.equal(parsed['@context'], 'https://schema.org')
  return ((parsed['@graph'] as Node[] | undefined) ?? [parsed]) as Node[]
}

/** Every @type anywhere inside a block, nested ones included. */
function allTypes(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allTypes(x, out))
  else if (v && typeof v === 'object') {
    const o = v as Node
    if (typeof o['@type'] === 'string') out.push(o['@type'] as string)
    Object.values(o).forEach((x) => allTypes(x, out))
  }
  return out
}

const tutor = tutorProfileJsonLd({
  slug: 'ayesha-khan-tutor',
  name: 'Ayesha Khan',
  avatarUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/u/photo-1-crop.jpg',
  city: 'Lahore',
  areas: ['DHA Lahore', 'Gulberg'],
  subjects: ['Physics', 'Mathematics', 'Physics'],
  levels: ['O Levels', 'O Levels'],
})
const job = jobPostingJsonLd({
  url: 'https://www.tutormint.org/tuitions/lahore/home-tutor-required-abc123',
  title: 'Home Tutor Required | Grade 5 | DHA, Lahore',
  description: 'A home tutor is needed for Grade 5 in DHA, Lahore. Three days a week.',
  datePosted: '2026-10-10T00:00:00Z',
  validThrough: '2026-10-25T00:00:00Z',
  city: 'Lahore',
  area: 'DHA',
  subjects: ['Mathematics'],
  budgetMin: 10000,
  budgetMax: 15000,
  employmentType: 'PART_TIME',
  refId: 'TM-2001',
})
const hub = collectionPageJsonLd({
  name: 'Physics tutors in Lahore',
  url: 'https://www.tutormint.org/tutors/lahore/o-levels-physics',
  description: 'Seven Physics tutors in Lahore.',
  items: Array.from({ length: 30 }, (_, i) => ({ name: `Tutor ${i}`, url: `https://www.tutormint.org/tutor/t-${i}` })),
})
const article = articleJsonLd({
  url: 'https://www.tutormint.org/blog/a-post',
  title: 'A post',
  description: 'About something.',
  image: null,
  datePublished: '2026-10-01T00:00:00Z',
  dateModified: '2026-10-02T00:00:00Z',
  language: 'en',
  legalName: COMPANY.legalName,
  section: 'Tutor career',
})

const PAGES: Record<string, unknown[]> = {
  'site-wide': [siteGraphJsonLd(COMPANY, '923215872222')],
  about: [aboutPageJsonLd()],
  faq: [faqJsonLd(FAQ_ITEMS)],
  'tutor profile': [tutor],
  tuition: [job],
  hub: [hub],
  'blog post': [article],
}

test('every block is valid JSON with a schema.org type we mean to emit', () => {
  for (const [page, blocks] of Object.entries(PAGES)) {
    for (const b of blocks) {
      for (const node of emitted(b)) {
        assert.ok(ALLOWED.has(String(node['@type'])), `${page}: ${String(node['@type'])}`)
      }
    }
  }
})

test('no AggregateRating, Review or rating anywhere', () => {
  for (const [page, blocks] of Object.entries(PAGES)) {
    const text = JSON.stringify(blocks)
    assert.ok(!/AggregateRating|"Review"|ratingValue|reviewCount|aggregateRating/.test(text), page)
    assert.ok(!allTypes(blocks).some((t) => t === 'AggregateRating' || t === 'Review' || t === 'Rating'), page)
  }
  assert.ok(!/aggregateRating|AggregateRating/.test(readFileSync('lib/seo.ts', 'utf8')), 'lib/seo.ts builds no rating')
})

test('Organization and WebSite: one graph, @id references, the tagline exactly', () => {
  const nodes = emitted(siteGraphJsonLd(COMPANY, '923215872222'))
  assert.deepEqual(nodes.map((n) => n['@type']), ['Organization', 'WebSite'])
  const [org, site] = nodes
  assert.equal(org['@id'], ORGANIZATION_ID)
  assert.equal(site['@id'], WEBSITE_ID)
  assert.equal(org.name, 'TutorMint')
  assert.equal(org.slogan, 'Free to join. No commission. No middleman.')
  assert.equal(SITE_TAGLINE, 'Free to join. No commission. No middleman.')
  assert.equal(org.description, SITE_DESCRIPTION)
  assert.deepEqual(org.areaServed, { '@type': 'Country', name: 'Pakistan' })
  const contact = org.contactPoint as Node
  assert.equal(contact.telephone, '+92-321-5872222')
  assert.equal(contact.contactType, 'customer support')
  assert.deepEqual(contact.availableLanguage, ['en', 'ur'])
  assert.deepEqual(site.publisher, { '@id': ORGANIZATION_ID })
  const action = site.potentialAction as { target: { urlTemplate: string } }
  assert.equal(action.target.urlTemplate, 'https://www.tutormint.org/browse/tutors?q={search_term_string}')
  for (const need of ['name', 'url', 'logo', 'description', 'slogan', 'contactPoint']) assert.ok(org[need], need)
})

test('Organization and WebSite are emitted once — by the site chrome, not by a page', () => {
  const chrome = readFileSync('components/SiteChrome.tsx', 'utf8')
  assert.equal((chrome.match(/siteGraphJsonLd\(/g) ?? []).length, 1)
  for (const f of [
    'app/(site)/page.tsx',
    'app/(site)/about/page.tsx',
    'app/(site)/faq/page.tsx',
    'app/(site)/tutor/[slug]/page.tsx',
    'app/(site)/tuitions/[city]/[slug]/page.tsx',
    'app/(site)/blog/[slug]/page.tsx',
    'components/landing/LandingView.tsx',
    'components/tuitionJobs/CityJobsView.tsx',
    'app/(site)/tuition-jobs/school/[school]/page.tsx',
  ]) {
    const src = readFileSync(f, 'utf8')
    assert.ok(!/organizationJsonLd\(|webSiteJsonLd\(|siteGraphJsonLd\(/.test(src), `${f} must not emit its own Organization / WebSite`)
  }
})

test('the homepage title and description name both sides; the rest of the hero is untouched', () => {
  assert.ok(/Tutors/.test(HOME_TITLE) && /Tuition/.test(HOME_TITLE))
  assert.ok(HOME_TITLE.length <= 60)
  assert.ok(/tutors/.test(SITE_DESCRIPTION) && /tuitions/.test(SITE_DESCRIPTION))
  const home = readFileSync('app/(site)/page.tsx', 'utf8')
  assert.ok(home.includes('HOME_TITLE') && home.includes('SITE_DESCRIPTION'))
  // The H1 is the owner-approved 13 Oct 2026 text, with the same styling.
  assert.equal(HOME_H1, 'Find verified tutors in Pakistan — or find tuitions as a tutor')
  assert.ok(home.includes('<h1 className="tm-headline mt-2 text-balance text-3xl font-black leading-[1.15] text-tm-black sm:mt-3 sm:text-5xl md:text-6xl">'))
  assert.ok(home.includes('{HOME_H1_LINES[0]}') && home.includes('{HOME_H1_LINES[1]}'))
  assert.equal((home.match(/<h1 className=/g) ?? []).length, 1)
  // The red line, the Urdu line and the two buttons are as approved.
  assert.ok(home.includes('Free to Join &bull; No Commission &bull; No Middleman &bull; Live Demo'))
  assert.ok(home.includes('کوئی فیس نہیں &bull; کوئی کمیشن نہیں &bull; کوئی مڈل مین نہیں &bull; لائیو ڈیمو'))
  assert.ok(home.includes('label="Find Tutors / Teachers"') && home.includes('label="Find Tuitions / Jobs"'))
})

test('AboutPage points at the Organization', () => {
  const [about] = emitted(aboutPageJsonLd())
  assert.equal(about['@type'], 'AboutPage')
  assert.deepEqual(about.mainEntity, { '@id': ORGANIZATION_ID })
  const page = readFileSync('app/(site)/about/page.tsx', 'utf8')
  assert.ok(page.includes('aboutPageJsonLd()') && page.includes('SITE_FEATURES') && page.includes('/membership-plans'))
  // No plan price on a public page.
  assert.ok(!/Rs\.?\s?(199|499|999)/.test(page))
})

test('tutor profile: ProfilePage + Person, nothing private, no fee, no employer', () => {
  const nodes = emitted(tutor)
  assert.deepEqual(nodes.map((n) => n['@type']), ['ProfilePage', 'Person'])
  const [page, person] = nodes
  assert.deepEqual(page.isPartOf, { '@id': WEBSITE_ID })
  assert.deepEqual(page.mainEntity, { '@id': person['@id'] })
  assert.equal(person.name, 'Ayesha Khan')
  assert.equal(person.jobTitle, 'Tutor')
  assert.deepEqual(person.knowsAbout, ['Physics', 'Mathematics', 'O Levels'])
  assert.deepEqual(
    (person.areaServed as Node[]).map((p) => p.name),
    ['DHA Lahore', 'Gulberg, Lahore', 'Lahore'],
  )
  assert.ok(person.image)
  for (const banned of ['telephone', 'email', 'address', 'worksFor', 'affiliation', 'offers', 'priceRange', 'identifier', 'birthDate']) {
    assert.equal(person[banned], undefined, banned)
    assert.equal(page[banned], undefined, banned)
  }
  const text = JSON.stringify(nodes)
  assert.ok(!/\+92|03\d{2}[ -]?\d{7}|\d{5}-\d{7}-\d|@[a-z0-9-]+\.[a-z]{2,}|PKR|price/i.test(text), 'no phone, CNIC, email or fee')
  // The default avatar is never an image: no photo → no image key.
  const [, plain] = emitted(tutorProfileJsonLd({ slug: 's', name: 'Ali', avatarUrl: null, city: null, areas: [], subjects: [], levels: [] }))
  assert.equal(plain.image, undefined)
  assert.equal(plain.knowsAbout, undefined)
  assert.equal(plain.areaServed, undefined)
})

test('tutor meta description: verified only when true, the mode from the Job Types', () => {
  assert.equal(
    tutorMetaDescription({ name: 'Ayesha Khan', subjects: ['Physics', 'Mathematics'], city: 'Lahore', areas: ['DHA Lahore', 'Gulberg'], jobTypes: ['Home Tutor', 'Online Tutor'], verified: true }),
    'Ayesha Khan — verified Physics, Mathematics tutor in DHA & Gulberg, Lahore (home/online). Contact directly on TutorMint, no commission.',
  )
  assert.equal(
    tutorMetaDescription({ name: 'Ali', subjects: [], city: 'Karachi', areas: [], jobTypes: ['Primary Teacher'], verified: false }),
    'Ali — tutor in Karachi. Contact directly on TutorMint, no commission.',
  )
})

test('tuition: JobPosting is hired by a private client via TutorMint, applied to on the page', () => {
  const [j] = emitted(job)
  assert.equal(j['@type'], 'JobPosting')
  const org = j.hiringOrganization as Node
  assert.equal(org.name, PRIVATE_CLIENT_NAME)
  assert.equal(org.name, 'Private tutoring client (via TutorMint)')
  assert.equal(org.sameAs, 'https://www.tutormint.org')
  assert.equal(j.directApply, true)
  assert.equal(j.validThrough, '2026-10-25T00:00:00Z', 'validThrough is passed through unchanged')
  for (const need of ['title', 'description', 'datePosted', 'jobLocation']) assert.ok(j[need], need)
  // A post that names its school is still that school's vacancy.
  const [s] = emitted(jobPostingJsonLd({ url: 'u', title: 't', description: 'd', datePosted: '2026-10-10', city: 'Lahore', area: null, subjects: [], budgetMin: null, budgetMax: null, schoolName: 'Naveed Majeed Academy' }))
  assert.deepEqual(s.hiringOrganization, { '@type': 'Organization', name: 'Naveed Majeed Academy' })
})

test('hub: CollectionPage + ItemList, at most 20 items, url and name only', () => {
  const nodes = emitted(hub)
  assert.deepEqual(nodes.map((n) => n['@type']), ['CollectionPage', 'ItemList'])
  const [page, list] = nodes
  assert.deepEqual(page.mainEntity, { '@id': list['@id'] })
  assert.deepEqual(page.isPartOf, { '@id': WEBSITE_ID })
  const items = list.itemListElement as Node[]
  assert.equal(items.length, COLLECTION_ITEMS_MAX)
  assert.equal(COLLECTION_ITEMS_MAX, 20)
  assert.equal(list.numberOfItems, 20)
  for (const it of items) assert.deepEqual(Object.keys(it).sort(), ['@type', 'name', 'position', 'url'])
  // Every hub view uses it, and none still emits a bare ItemList.
  for (const f of ['components/landing/LandingView.tsx', 'components/tuitionJobs/CityJobsView.tsx', 'app/(site)/tuition-jobs/school/[school]/page.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.ok(src.includes('collectionPageJsonLd(') && !src.includes('itemListJsonLd('), f)
  }
})

test('blog post: Article with dates, the configured author, publisher → the Organization', () => {
  const [a] = emitted(article)
  assert.equal(a['@type'], 'Article')
  assert.equal((a.publisher as Node)['@id'], ORGANIZATION_ID)
  assert.equal((a.author as Node).name, COMPANY.legalName)
  assert.ok(a.datePublished && a.dateModified && a.headline)
})

test('FAQPage data is the visible FAQ text, and answers the nine basics', () => {
  const [faq] = emitted(faqJsonLd(FAQ_ITEMS))
  const main = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
  assert.equal(main.length, FAQ_ITEMS.length)
  FAQ_ITEMS.forEach((item, i) => {
    assert.equal(main[i].name, item.q)
    assert.equal(main[i].acceptedAnswer.text, item.a)
  })
  // The page renders the same strings it hands the builder.
  const page = readFileSync('app/(site)/faq/page.tsx', 'utf8')
  assert.ok(page.includes('faqJsonLd(FAQ_ITEMS)') && page.includes('{item.q}') && page.includes('{item.a}'))
  const basics = FAQ_GROUPS.find((g) => g.id === 'basics')!
  assert.equal(basics.items.length, 10)
  assert.equal(FAQ_GROUPS[0].id, 'basics')
  const qs = new Set(FAQ_ITEMS.map((i) => i.q))
  assert.equal(qs.size, FAQ_ITEMS.length, 'no question twice')
  const support = basics.items.find((i) => i.q === 'How do I get support?')!
  assert.ok(support.a.includes('0321 5872222'))
  // No plan price in any answer.
  for (const item of basics.items) assert.ok(!/Rs\.?\s?\d/.test(item.a), item.q)
})

test('/llms.txt: both sides, the features, the key pages, no personal data', () => {
  const text = llmsText()
  assert.ok(text.startsWith('# TutorMint'))
  assert.ok(text.includes(SITE_DESCRIPTION) && text.includes(SITE_TAGLINE))
  assert.ok(text.includes('## For parents') && text.includes('## For tutors'))
  for (const f of SITE_FEATURES) assert.ok(text.includes(f), f)
  for (const p of ['/browse/tutors', '/browse/tuitions', '/about', '/faq', '/membership-plans', '/blog', '/sitemap.xml']) {
    assert.ok(text.includes(`https://www.tutormint.org${p}`), p)
  }
  assert.ok(!/Rs\.?\s?\d|\d{5}-\d{7}-\d/.test(text), 'no price, no CNIC')
  assert.ok(readFileSync('app/llms.txt/route.ts', 'utf8').includes('llmsText()'))
})

test('the Indexing API is still told about tuition pages only', () => {
  for (const f of ['app/(site)/about/page.tsx', 'app/(site)/tutor/[slug]/page.tsx', 'components/landing/LandingView.tsx', 'app/llms.txt/route.ts', 'lib/siteIdentity.ts']) {
    assert.ok(!/queueIndexingUpdate|notifyUrlUpdated|indexing_queue/.test(readFileSync(f, 'utf8')), f)
  }
})
