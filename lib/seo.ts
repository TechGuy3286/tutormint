// lib/seo.ts
//
// Titles, descriptions and structured data, in one place.
//
// THE PROMISE GOES IN THE TITLE. A search result shows the title almost always
// and the description often enough that Google rewrites it — so "no
// commission" belongs where it will actually be read. That is why the template
// is "<page> — verified, no commission | TutorMint" rather than putting the
// differentiator in the description and hoping.
//
// Nothing here invents a fact. The Organization block carries the legal name,
// the registered office and the support email from app_settings, and the
// social profiles only from the SOCIAL_* variables that are actually set: an
// unset handle emits nothing rather than a guess, which is the same rule the
// footer already follows. A `sameAs` pointing at a stranger's account is worse
// than an absent one, because search engines treat it as an identity claim.

import { SITE_URL, absoluteUrl } from '@/lib/siteUrl'
import type { Company } from '@/lib/company'

export const BRAND = 'TutorMint'
export const SLOGAN = 'No fee, no commission, no middleman'

const TITLE_SUFFIX = 'verified, no commission'
const DESCRIPTION_TAIL =
  "on TutorMint, Pakistan's verified tutors network. No fee, no commission, no middleman."

/**
 * "<page> — verified, no commission | TutorMint"
 *
 * Kept under about 60 characters where the page name allows, because a title
 * that is cut off loses its tail — and the tail is the part carrying the
 * promise. A very long page name (a tutor's full name plus three subjects)
 * will still be truncated by the search engine; that is preferable to dropping
 * the brand.
 */
export function pageTitle(page: string): string {
  return `${page} — ${TITLE_SUFFIX} | ${BRAND}`
}

/**
 * "<lead> on TutorMint, Pakistan's verified tutors network. No fee, no
 * commission, no middleman."
 *
 * The lead should end without punctuation; this joins it.
 */
export function pageDescription(lead: string): string {
  const trimmed = lead.trim().replace(/[.\s]+$/, '')
  return `${trimmed} ${DESCRIPTION_TAIL}`
}

/** The social profiles that actually exist. An unset handle emits nothing. */
export function sameAs(): string[] {
  return [
    process.env.SOCIAL_FACEBOOK,
    process.env.SOCIAL_INSTAGRAM,
    process.env.SOCIAL_YOUTUBE,
    process.env.SOCIAL_X,
    process.env.SOCIAL_TIKTOK,
  ]
    .map((u) => (u ?? '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
}

/**
 * Organization.
 *
 * `legalName` and `name` are deliberately different: the registered entity is
 * "Tutor Mint (Private) Limited" and the brand is "TutorMint". Search engines
 * read `name` as the thing to display and `legalName` as the entity behind it,
 * which is exactly the distinction the brand rule draws.
 *
 * The two identifiers are only emitted once they are real. Publishing
 * `"identifier": "{{COMPANY_REG_NO}}"` as structured data would be asserting a
 * registration number that is a placeholder string — the placeholder is honest
 * on a page a person reads and dishonest in a machine-readable claim.
 */
export function organizationJsonLd(company: Company, phone: string | null) {
  const social = sameAs()

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: BRAND,
    legalName: company.legalName,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/tutormint-logo1200x630.png'),
      width: 1200,
      height: 630,
    },
    image: absoluteUrl('/tutormint-logo1200x630.png'),
    slogan: SLOGAN,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '4th Floor, 37-M, Civic Center, Model Town',
      addressLocality: 'Lahore',
      addressRegion: 'Punjab',
      addressCountry: 'PK',
    },
    email: company.email,
    ...(phone ? { telephone: `+${phone}` } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: company.email,
      ...(phone ? { telephone: `+${phone}` } : {}),
      areaServed: 'PK',
      availableLanguage: ['en', 'ur'],
    },
    // Only when it is a real number — see the note above.
    ...(company.regNoPending ? {} : { identifier: company.regNo }),
    ...(social.length > 0 ? { sameAs: social } : {}),
  }
}

/**
 * WebSite, with the SearchAction that lets a search engine offer a sitelinks
 * search box straight into /browse/tutors.
 *
 * It points at the tutor directory rather than a generic /search, because that
 * is the search this site actually has — `query-input` maps to the `q`
 * parameter the browse page already reads.
 */
export function webSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: BRAND,
    description: pageDescription('Find verified, degree-checked tutors across Pakistan'),
    inLanguage: 'en-PK',
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/browse/tutors?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

/**
 * A tutor, as a Person who provides a Service.
 *
 * Person and Service rather than one or the other: the person is who a parent
 * hires, and the service is what they are hiring. `provider` links them, so a
 * search engine reading either finds the other.
 *
 * NOTHING IS ASSERTED THAT THE PROFILE DOES NOT HOLD. No rating unless there
 * are real reviews, no price unless a rate is set, no area unless one is
 * chosen. An `aggregateRating` with a zero count is a rich-result violation
 * and, more to the point, a claim about a tutor nobody has reviewed.
 */
export function tutorJsonLd(t: {
  slug: string
  name: string
  headline: string | null
  avatarUrl: string | null
  city: string | null
  area: string | null
  subjects: string[]
  hourlyRatePkr: number | null
  ratingAvg: number | null
  ratingCount: number | null
}) {
  const url = absoluteUrl(`/tutor/${t.slug}`)
  const areaServed = [t.area, t.city].filter(Boolean).join(', ') || null

  const person = {
    '@type': 'Person',
    '@id': `${url}#person`,
    name: t.name,
    url,
    ...(t.headline ? { jobTitle: t.headline } : {}),
    ...(t.avatarUrl ? { image: t.avatarUrl } : {}),
    ...(t.subjects.length > 0 ? { knowsAbout: t.subjects } : {}),
    ...(areaServed
      ? { address: { '@type': 'PostalAddress', addressLocality: t.city, addressCountry: 'PK' } }
      : {}),
    worksFor: { '@id': `${SITE_URL}/#organization` },
  }

  const service = {
    '@type': 'Service',
    '@id': `${url}#service`,
    serviceType: t.subjects.length > 0 ? `${t.subjects.join(', ')} tutoring` : 'Private tutoring',
    provider: { '@id': `${url}#person` },
    url,
    ...(areaServed ? { areaServed: { '@type': 'Place', name: areaServed } } : {}),
    ...(t.hourlyRatePkr
      ? {
          offers: {
            '@type': 'Offer',
            price: t.hourlyRatePkr,
            priceCurrency: 'PKR',
            availability: 'https://schema.org/InStock',
          },
        }
      : {}),
    // Only with real reviews behind it.
    ...(t.ratingAvg && t.ratingCount && t.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: t.ratingAvg,
            reviewCount: t.ratingCount,
          },
        }
      : {}),
  }

  return { '@context': 'https://schema.org', '@graph': [person, service] }
}

/** FAQPage, from the same array the page renders. */
export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${absoluteUrl('/faq')}#faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/**
 * One <script type="application/ld+json">.
 *
 * Every caller builds its object from typed literals and database values;
 * JSON.stringify escapes the quotes, and `<` is escaped explicitly because a
 * name containing "</script>" would otherwise close the tag early. Nothing in
 * our data does that today, which is exactly when it is cheap to prevent.
 */
export function jsonLdScript(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') }
}
