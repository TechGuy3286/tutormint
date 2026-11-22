// PURE. The public footer's link columns (PR-15 tidy).
//
// Each link appears once: Sign Up, Login, Dashboard and Membership Plans used
// to sit in both the For Tutors and For Parents columns; they now live once in
// "Account". The city links are two short columns over ONE set of cities —
// "Tuition jobs in <city>" and, for the same cities where that page is
// indexable, "Female teaching jobs in <city>" — drawn without wrapping.

export type FooterLink = {
  label: string
  href: string
  /** The homepage lists these itself, so the footer leaves them out there. */
  hideOnHome?: boolean
  /** Guests only (Sign Up, Login) — decided in the browser. */
  guestOnly?: boolean
  /** Signed-in members only; the href is their own dashboard (browser). */
  memberDashboard?: boolean
}
export type LinkColumn = { heading: string; links: FooterLink[] }

/** How many cities the footer names. */
export const FOOTER_CITY_MAX = 5

export type FooterCity = { city: string; citySlug: string; href: string }

export function footerColumns(
  cities: FooterCity[],
  female: { label: string; href: string }[],
): { main: LinkColumn[]; cities: LinkColumn[] } {
  const set = cities.slice(0, FOOTER_CITY_MAX)
  const femaleHref = new Set(female.map((f) => f.href))
  const main: LinkColumn[] = [
    {
      heading: 'For Tutors',
      links: [
        { label: 'Find Tuitions', href: '/browse/tuitions' },
        { label: 'Blog & Guides', href: '/blog' },
      ],
    },
    {
      heading: 'For Parents',
      links: [
        { label: 'Find Tutors', href: '/browse/tutors' },
        { label: 'Post a Tuition', href: '/post-tuition' },
      ],
    },
    {
      heading: 'Account',
      links: [
        { label: 'Sign Up', href: '/register', guestOnly: true },
        { label: 'Login', href: '/login', guestOnly: true },
        { label: 'Dashboard', href: '/login', memberDashboard: true },
        { label: 'Membership Plans', href: '/membership-plans' },
      ],
    },
    {
      heading: 'Trust & Legal',
      links: [
        { label: 'About Us', href: '/about' },
        { label: 'FAQs', href: '/faq' },
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Terms of Service', href: '/terms' },
      ],
    },
  ]
  const cityCols: LinkColumn[] = []
  if (set.length > 0) {
    cityCols.push({
      heading: 'Tuition jobs by city',
      links: set.map((c) => ({ label: `Tuition jobs in ${c.city}`, href: c.href, hideOnHome: true })),
    })
    const fem = set
      .map((c) => ({ c, href: `/tuition-jobs/${c.citySlug}/female` }))
      .filter((x) => femaleHref.has(x.href))
      .map(({ c, href }) => ({ label: `Female teaching jobs in ${c.city}`, href }))
    if (fem.length > 0) cityCols.push({ heading: 'Female teaching jobs', links: fem })
  }
  return { main, cities: cityCols }
}
