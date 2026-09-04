// components/Footer.tsx — the compact black footer from
// design/reference/homepage.png.
//
// It is rendered by SiteChrome, so this is the footer on every public page:
// brand column, four link columns, social row, and the "Verified Secure
// Platform" line. /admin has its own shell and never renders this.
//
// TWO BODIES, one for phones and one for md+ (CLAUDE.md "Mobile footer",
// 5 Sep 2026). Below 768px the footer was a full screen — fourteen 44px links
// stacked into a 2-column grid. It is now: the logo line, one row of social
// icons, four collapsed sections (native <details>, so tap-to-open needs no
// JS and this file stays a server component), and the legal line. The desktop
// body (`hidden md:block`) is the APPROVED layout, unchanged.
//
// Two behaviours the mobile body adds, both intended:
//   * Signed-in members do not see Sign Up or Login (in either body). Showing a
//     signed-in visitor a login link is a wart; the locked design is the guest
//     case, and for a guest nothing changes.
//   * A link in both the Tutors and Parents sections (Sign Up, Login) appears
//     ONCE on mobile — deduped by href across the sections.
//
// signedIn comes from getSessionUser(), which is React-cache()d and already
// called by the Navbar in the same render, so this adds no auth round trip and
// no new dynamic cost the Navbar has not already paid.
//
// Nothing is hardcoded: the support email, WhatsApp number and five social
// profiles are environment-configured, and a channel with nothing set is not
// rendered rather than shown as a dead link (CLAUDE.md rule 7).

import Image from 'next/image'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { supportContactFromEnv } from '@/lib/support'
import { getSessionUser } from '@/lib/auth'

type SocialLink = { name: string; icon: string; href: string }
type FooterLink = { label: string; href: string }
type LinkColumn = { heading: string; links: FooterLink[] }

/** The social profiles, in the reference's order. Only configured ones render. */
function socialLinks(): SocialLink[] {
  const configured: [string, string, string | undefined][] = [
    ['Facebook', '/facebook.png', process.env.SOCIAL_FACEBOOK],
    ['Instagram', '/instagram.png', process.env.SOCIAL_INSTAGRAM],
    ['YouTube', '/youtube.png', process.env.SOCIAL_YOUTUBE],
    ['X', '/x.png', process.env.SOCIAL_X],
    ['TikTok', '/tiktok.png', process.env.SOCIAL_TIKTOK],
  ]

  return configured
    .filter(([, , href]) => !!href?.trim())
    .map(([name, icon, href]) => ({ name, icon, href: href!.trim() }))
}

/** The two link columns whose auth links are hidden once signed in. */
function linkColumns(signedIn: boolean): LinkColumn[] {
  const auth: FooterLink[] = signedIn ? [] : [
    { label: 'Sign Up', href: '/register' },
    { label: 'Login', href: '/login' },
  ]
  return [
    {
      heading: 'For Tutors',
      links: [
        // The browse pages are the platform's organic-search surface and were
        // linked from no footer column at all (T-SEO2 named the footer).
        { label: 'Find Tuitions', href: '/browse/tuitions' },
        ...auth,
        { label: 'Dashboard', href: '/tutor/dashboard' },
        { label: 'Packages', href: '/tutor/packages' },
      ],
    },
    {
      heading: 'For Parents',
      links: [
        { label: 'Find Tutors', href: '/browse/tutors' },
        ...auth,
        { label: 'Dashboard', href: '/parent/dashboard' },
        { label: 'Packages', href: '/parent/packages' },
      ],
    },
    {
      heading: 'Trust & Legal',
      links: [
        { label: 'About Us', href: '/about' },
        { label: 'Blog & Guides', href: '/blog' },
        { label: 'FAQs', href: '/faq' },
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Terms of Service', href: '/terms' },
      ],
    },
  ]
}

export default async function Footer() {
  const support = supportContactFromEnv()
  const socials = socialLinks()
  const signedIn = !!(await getSessionUser())
  const columns = linkColumns(signedIn)
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto bg-tm-black text-slate-300">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-6">
        {/* ---------------------------------------------------- MOBILE ---- */}
        {/* Below md: logo, social row, four tap-to-open sections, legal. */}
        <div className="space-y-5 md:hidden">
          <div>
            <Image
              src="/TutorMint-Footer-Logo-2448x752.png"
              alt="TutorMint"
              width={2048}
              height={752}
              sizes="87px"
              className="h-8 w-auto object-contain"
            />
            <p className="mt-2 max-w-xs text-xs leading-snug text-slate-400">
              Pakistan&rsquo;s Largest 100% Verified Tutors Network. 0% commission.
            </p>
            <SocialRow socials={socials} />
          </div>

          <div className="divide-y divide-white/10 border-y border-white/10">
            <MobileSections columns={columns} />
            <MobileSupport support={support} />
          </div>

          <LegalLine year={year} />
        </div>

        {/* --------------------------------------------------- DESKTOP ---- */}
        {/* md+: the approved layout, unchanged. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
            {/* Brand */}
            <div className="lg:pr-4">
              <Image
                src="/TutorMint-Footer-Logo-2448x752.png"
                alt="TutorMint"
                width={2048}
                height={752}
                sizes="87px"
                className="h-8 w-auto object-contain"
              />
              <p className="mt-2 max-w-xs text-xs leading-snug text-slate-400">
                Pakistan&rsquo;s Largest 100% Verified Tutors Network. 0% commission.
              </p>
              <SocialRow socials={socials} />
            </div>

            {/* The link lists, handed to the 5-column grid at lg. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:contents">
              {columns.map((col) => (
                <FooterColumn key={col.heading} heading={col.heading} links={col.links} />
              ))}

              {/* Support & contact */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">
                  Support &amp; Contact
                </h2>
                <ul className="mt-2 text-sm">
                  <li className="flex min-h-[44px] items-center text-slate-400 md:min-h-[28px]">
                    Lahore, Pakistan
                  </li>
                  {support.email && (
                    <li>
                      <a
                        href={`mailto:${support.email}`}
                        className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
                      >
                        {support.email}
                      </a>
                    </li>
                  )}
                  <li>
                    <Link
                      href="/support"
                      className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
                    >
                      Help &amp; Support
                    </Link>
                  </li>
                  <li className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-tm-mint md:min-h-[28px]">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-tm-mint" />
                    Verified Secure Platform
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <LegalLine year={year} />
          </div>
        </div>
      </div>
    </footer>
  )
}

/** One row of social icons. Only configured profiles render. */
function SocialRow({ socials }: { socials: SocialLink[] }) {
  if (socials.length === 0) return null
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1">
      {socials.map((s) => (
        <li key={s.name}>
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer me"
            aria-label={`TutorMint on ${s.name}`}
            className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
          >
            <Image src={s.icon} alt="" width={2048} height={2048} sizes="20px" className="h-5 w-5 object-contain" />
          </a>
        </li>
      ))}
    </ul>
  )
}

/** The legal line — no "Empowering education across Pakistan" (dropped 5 Sep). */
function LegalLine({ year }: { year: number }) {
  return (
    <p className="text-xs text-slate-400">
      {/* The legal entity, not the brand. CLAUDE.md confines "Tutor Mint (Pvt)
          Ltd" to legal contexts; the copyright line is one of them. */}
      &copy; {year} Tutor Mint (Pvt) Ltd. All rights reserved.
    </p>
  )
}

/**
 * The tutor / parent / legal sections as tap-to-open accordions on mobile.
 * Deduped by href across the sections, so a link in both the Tutors and Parents
 * sections (Sign Up, Login) appears once.
 */
function MobileSections({ columns }: { columns: LinkColumn[] }) {
  const seen = new Set<string>()
  return (
    <>
      {columns.map((col) => {
        const links = col.links.filter((l) => {
          if (seen.has(l.href)) return false
          seen.add(l.href)
          return true
        })
        if (links.length === 0) return null
        return (
          <details key={col.heading} className="group">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-tm-mint marker:content-['']">
              {col.heading}
              <ChevronDown
                aria-hidden
                size={16}
                className="text-slate-400 transition-transform group-open:rotate-180"
              />
            </summary>
            <ul className="pb-1 text-sm">
              {links.map((l) => (
                <li key={l.href + l.label}>
                  <Link
                    href={l.href}
                    className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )
      })}
    </>
  )
}

/** Support & contact as a mobile accordion, matching the link sections. */
function MobileSupport({ support }: { support: { email: string | null } }) {
  return (
    <details className="group">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-tm-mint marker:content-['']">
        Support &amp; Contact
        <ChevronDown aria-hidden size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="pb-1 text-sm">
        <li className="flex min-h-[44px] items-center text-slate-400">Lahore, Pakistan</li>
        {support.email && (
          <li>
            <a
              href={`mailto:${support.email}`}
              className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
            >
              {support.email}
            </a>
          </li>
        )}
        <li>
          <Link
            href="/support"
            className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
          >
            Help &amp; Support
          </Link>
        </li>
        <li className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-tm-mint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-tm-mint" />
          Verified Secure Platform
        </li>
      </ul>
    </details>
  )
}

/**
 * One desktop link column.
 *
 * Tap targets are 44px on touch-sized viewports and tighten to 30px from md up.
 * WCAG 2.5.8's own minimum is 24px.
 */
function FooterColumn({ heading, links }: { heading: string; links: FooterLink[] }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">{heading}</h2>
      <ul className="mt-2 text-sm">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
