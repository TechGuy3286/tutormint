// lib/siteIdentity.ts
//
// Who TutorMint is, said once (owner, 13 Oct 2026). Every page title, meta
// description, JSON-LD block, the About page, the FAQ's first group and
// /llms.txt read from here, so the site describes itself the same way
// everywhere: a two-sided platform — parents find tutors, tutors find tuitions.
//
// PURE: no database, no server-only import, so server pages, route handlers and
// the tests all read it. The two facts an owner can change without a deploy
// (support number and email) are read by their own loaders (lib/support) and
// passed in where they are shown; the values here are the same fallbacks those
// loaders use.
//
// HONEST ONLY: nothing here is a number, a rating or a promise. A count shown
// anywhere is computed from the database by the page that shows it.

import { SITE_URL, absoluteUrl } from '@/lib/siteUrl'
import { SUPPORT_EMAIL_FALLBACK, SUPPORT_PHONE_SCHEMA, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/supportContacts'

export const SITE_NAME = 'TutorMint'

/** The tagline, exactly. */
export const SITE_TAGLINE = 'Free to join. No commission. No middleman.'

/** The one-sentence description — the homepage meta description and the Organization description. */
export const SITE_DESCRIPTION =
  'TutorMint connects parents with verified home and online tutors across Pakistan, and helps tutors find tuitions — free to join, no commission, no middleman.'

/** The same thing, one sentence for each side. */
export const SITE_TWO_SIDED = {
  parents:
    'Parents, schools and academies browse verified home and online tutors by subject, level, city, area, gender and teaching mode, post a tuition free, and contact tutors directly.',
  tutors:
    'Tutors get verified, build a public profile with their subjects, levels and areas, and apply to tuition and teaching jobs across Pakistan — TutorMint takes no commission.',
}

/** The logo lockup (mark + wordmark, no tagline line) — the clean file made by
 *  scripts/build-clean-logos.ts (owner, 14 Oct 2026). The header, the
 *  Organization and publisher logo and composed covers all use it. */
export const SITE_LOGO_PATH = '/brand/tutormint-logo.png'
export const SITE_LOGO_SIZE = { width: 2048, height: 752 } as const
/** The same lockup for dark surfaces (the footer). */
export const SITE_LOGO_DARK_PATH = '/brand/tutormint-logo-dark.png'

/** What the platform offers, as short plain phrases. */
export const SITE_FEATURES: string[] = [
  'Verified tutors — CNIC and selfie checked by staff',
  'Browse tutors by subject, level, city, area, gender and teaching mode',
  'Parents post a tuition free and tutors apply',
  'Contact tutors directly — no commission',
  'Notify me when a matching tutor joins',
  'Tuition jobs for tutors across Pakistan',
  'Verified tutor profiles with subjects, levels and areas',
  'WhatsApp support',
  'Guides for parents and tutors (blog)',
]

/** How it works, three or four steps for each side. */
export const SITE_HOW_IT_WORKS = {
  parents: [
    'Browse tutors free — no account needed.',
    'Verify your mobile number to post a tuition, message a tutor or request a demo lesson.',
    'Read profiles, compare, and talk to the tutor directly.',
    'Agree the fee with the tutor. TutorMint takes no commission.',
  ],
  tutors: [
    'Sign up free and set your subjects, levels, city and areas.',
    'Get verified: pay the one-time Verification Fee and send your CNIC, a profile photo and a selfie.',
    'Apply to tuition and teaching jobs that match you.',
    'Keep everything you earn — no commission, no middleman.',
  ],
}

/** The pages that explain the site, for /llms.txt and the About page. */
export const SITE_KEY_PATHS: { label: string; path: string }[] = [
  { label: 'Find tutors', path: '/browse/tutors' },
  { label: 'Tuition and teaching jobs', path: '/browse/tuitions' },
  { label: 'About TutorMint', path: '/about' },
  { label: 'Questions and answers', path: '/faq' },
  { label: 'Membership plans', path: '/membership-plans' },
  { label: 'Guides for parents and tutors', path: '/blog' },
  { label: 'Support', path: '/support' },
  { label: 'Sign up', path: '/register' },
]

/** The homepage H1 (owner-approved, 13 Oct 2026), in its two lines. */
export const HOME_H1_LINES = ['Find verified tutors in Pakistan', '— or find tuitions as a tutor'] as const
export const HOME_H1 = HOME_H1_LINES.join(' ')

/** The two cards under the homepage buttons (owner-approved, 13 Oct 2026). */
export const HOME_CARDS: { title: string; points: string[]; links: { label: string; href: string }[] }[] = [
  {
    title: 'For parents',
    points: ['Find verified tutors free', 'Post a tuition free', 'Contact tutors directly'],
    links: [
      { label: 'Browse tutors', href: '/browse/tutors' },
      { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
    ],
  },
  {
    title: 'For tutors',
    points: ['Get verified', 'Find tuitions near you', 'No commission'],
    links: [
      { label: 'Become a tutor', href: '/register' },
      { label: 'Tuition jobs', href: '/browse/tuitions' },
    ],
  },
]

/** The plain links beside the homepage's city and tutor-page links. */
export const HOME_MORE_LINKS: { label: string; href: string }[] = [
  { label: 'Browse tutors', href: '/browse/tutors' },
  { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
  { label: 'Become a tutor', href: '/register' },
  { label: 'Blog', href: '/blog' },
]

/** The default page title, for any page that sets none of its own. No claim
 *  the site cannot prove (owner, 14 Oct 2026). */
export const SITE_DEFAULT_TITLE = `${SITE_NAME} — Verified Tutors & Tuition Jobs in Pakistan`

/** Titles that name both sides. */
export const HOME_TITLE = `Verified Tutors & Tuition Jobs in Pakistan | ${SITE_NAME}`

/** The social profiles that actually exist. An unset handle emits nothing. */
export function socialProfiles(): string[] {
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

export const ORGANIZATION_ID = `${SITE_URL}/#organization`
export const WEBSITE_ID = `${SITE_URL}/#website`

export const siteIdentity = {
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl(SITE_LOGO_PATH),
  tagline: SITE_TAGLINE,
  description: SITE_DESCRIPTION,
  twoSided: SITE_TWO_SIDED,
  features: SITE_FEATURES,
  howItWorks: SITE_HOW_IT_WORKS,
  areaServed: 'Pakistan',
  /** Fallbacks; the live values come from lib/support (app_settings first). */
  supportWhatsappDisplay: SUPPORT_WHATSAPP_DISPLAY,
  supportPhoneSchema: SUPPORT_PHONE_SCHEMA,
  supportEmail: SUPPORT_EMAIL_FALLBACK,
  keyPaths: SITE_KEY_PATHS,
} as const

/** /llms.txt — plain text, no personal data. */
export function llmsText(): string {
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `Tagline: ${SITE_TAGLINE}`,
    `Area served: Pakistan`,
    '',
    '## For parents, schools and academies',
    SITE_TWO_SIDED.parents,
    ...SITE_HOW_IT_WORKS.parents.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## For tutors',
    SITE_TWO_SIDED.tutors,
    ...SITE_HOW_IT_WORKS.tutors.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## What TutorMint offers',
    ...SITE_FEATURES.map((f) => `- ${f}`),
    '',
    '## Key pages',
    ...SITE_KEY_PATHS.map((p) => `- [${p.label}](${absoluteUrl(p.path)})`),
    `- [Sitemap](${absoluteUrl('/sitemap.xml')})`,
    '',
    '## Support',
    `WhatsApp: ${SUPPORT_WHATSAPP_DISPLAY}`,
    `Email: ${SUPPORT_EMAIL_FALLBACK}`,
    '',
  ]
  return lines.join('\n')
}
