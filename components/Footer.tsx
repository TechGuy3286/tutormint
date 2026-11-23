// components/Footer.tsx — the compact black footer from
// design/reference/homepage.png.
//
// It is rendered by SiteChrome, so this is the footer on every public page:
// brand column, four link columns, and the social row. /admin has its own
// shell and never renders this.
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
//   * Every link appears once (PR-15, lib/footerLinksCore): Sign Up, Login,
//     Dashboard and Membership Plans live in one "Account" column; the city
//     links are two short, non-wrapping columns over one set of cities.
//
// Whether someone is signed in is decided in the browser (GuestOnly, push 3,
// 1 Nov 2026): the footer reads no cookie, so the pages it sits on can be cached.
//
// Nothing is hardcoded: the support email, WhatsApp number and five social
// profiles are environment-configured, and a channel with nothing set is not
// rendered rather than shown as a dead link (CLAUDE.md rule 7).

import Image from 'next/image'
import { indexableCityPagesCached, cityPagePath } from '@/lib/cityJobs'
import { femaleFooterLinks } from '@/lib/femaleJobsCore'
import HideOnHome from '@/components/HideOnHome'
import Link from 'next/link'
import { SITE_LOGO_DARK_PATH, PUBLIC_LOCATION, googleBusinessUrl } from '@/lib/siteIdentity'
import { ChevronDown } from 'lucide-react'
import FooterTagline from '@/components/FooterTagline'
import { supportContactFromEnv, formatSupportWhatsApp, whatsappHref } from '@/lib/support'
import { GuestOnly, MemberDashboardLink } from '@/components/session/SessionChromeBits'
import { footerColumns, type FooterLink, type LinkColumn } from '@/lib/footerLinksCore'

type SocialLink = {
  name: string
  icon: string
  href: string
  /** Overrides the default `TutorMint on <name>` aria-label. */
  label?: string
  /** Overrides the default `noopener noreferrer me` (the `me` marks an owned
   *  profile — wrong for the support WhatsApp line). */
  rel?: string
}

/**
 * The social row's icons, in the reference's order. The five brand profiles are
 * env-configured and only a configured one renders; the WhatsApp support icon
 * (owner PR33 §2) always renders — its number is the one support constant, never
 * env-gated — and sits last, so a full set wraps as a tidy 3 + 3. The wa.me link
 * is built from the SAME support source the "WhatsApp us" auth links use.
 */
function socialLinks(supportWhatsapp: string | null): SocialLink[] {
  const configured: [string, string, string | undefined][] = [
    ['Facebook', '/facebook.png', process.env.SOCIAL_FACEBOOK],
    ['Instagram', '/instagram.png', process.env.SOCIAL_INSTAGRAM],
    ['YouTube', '/youtube.png', process.env.SOCIAL_YOUTUBE],
    ['X', '/x.png', process.env.SOCIAL_X],
    ['TikTok', '/tiktok.png', process.env.SOCIAL_TIKTOK],
  ]

  const links: SocialLink[] = configured
    .filter(([, , href]) => !!href?.trim())
    .map(([name, icon, href]) => ({ name, icon, href: href!.trim() }))

  // The Google Business Profile (PR-20 A.3) — always shown, same size and style.
  links.push({ name: 'Google', icon: '/google.png', href: googleBusinessUrl(), label: 'TutorMint on Google' })

  const wa = whatsappHref(supportWhatsapp)
  if (wa) {
    links.push({
      name: 'WhatsApp',
      icon: '/whatsapp.png',
      href: wa,
      label: 'WhatsApp support',
      rel: 'noopener noreferrer',
    })
  }
  return links
}

export default async function Footer() {
  const support = supportContactFromEnv()
  const socials = socialLinks(support.whatsapp)
  // The city tuition-jobs pages (live, 3+ open tuitions) — up to five in the
  // tutors column so they are never orphans. A read error leaves them out.
  let cols: { main: LinkColumn[]; cities: LinkColumn[] } = footerColumns([], [])
  try {
    // The cached link-block list (ten minutes, cleared with the landing cache):
    // the footer is on every page and must not read every open tuition each time.
    const pages = await indexableCityPagesCached()
    // One set of cities for both city columns (PR-15); the female page only
    // where it is indexable (3+ open matching tuitions).
    cols = footerColumns(
      pages.map((c) => ({ city: c.city, citySlug: c.citySlug, href: cityPagePath(c.citySlug) })),
      femaleFooterLinks(pages, pages.length),
    )
  } catch {
    cols = footerColumns([], [])
  }
  const columns = [...cols.main, ...cols.cities]
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto bg-tm-black text-slate-300">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-6">
        {/* ---------------------------------------------------- MOBILE ---- */}
        {/* Below md: logo, social row, four tap-to-open sections, legal. */}
        <div className="space-y-5 md:hidden">
          <div>
            <Image
              src={SITE_LOGO_DARK_PATH}
              alt="TutorMint"
              width={2048}
              height={752}
              sizes="87px"
              className="h-8 w-[87px] object-contain"
            />
            <FooterTagline />
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
          {/* PR-17 G.4: the brand column is wide enough (21rem, PR-20) for all seven
              social icons on ONE row on desktop; the five link columns share the rest. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[21rem_repeat(5,minmax(0,1fr))] lg:gap-8">
            {/* Brand */}
            <div>
              <Image
                src={SITE_LOGO_DARK_PATH}
                alt="TutorMint"
                width={2048}
                height={752}
                sizes="87px"
                className="h-8 w-[87px] object-contain"
              />
              <FooterTagline />
              <SocialRow socials={socials} oneRow />
            </div>

            {/* The link lists, handed to the 5-column grid at lg. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:contents">
              {cols.main.map((col) => (
                <FooterColumn key={col.heading} heading={col.heading} links={col.links} />
              ))}

              {/* Support & contact */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">
                  Support &amp; Contact
                </h2>
                <ul className="mt-2 text-sm">
                  <li className="flex min-h-[44px] items-center text-slate-400 md:min-h-[28px]">
                    {PUBLIC_LOCATION}
                  </li>
                  {support.whatsapp && (
                    <li>
                      <a
                        href={whatsappHref(support.whatsapp) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-[44px] items-center whitespace-nowrap text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
                      >
                        WhatsApp {formatSupportWhatsApp(support.whatsapp)}
                      </a>
                    </li>
                  )}
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
                      prefetch={false}
                      href="/contact"
                      className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
                    >
                      Contact us
                    </Link>
                  </li>
                  <li>
                    <Link
                      prefetch={false}
                      href="/support"
                      className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[28px]"
                    >
                      Help &amp; Support
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* The city columns (PR-15): short, one line per link, one set of cities. */}
          {cols.cities.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
              {cols.cities.map((col) => (
                <FooterColumn key={col.heading} heading={col.heading} links={col.links} nowrap />
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-white/10 pt-3">
            <LegalLine year={year} />
          </div>
        </div>
      </div>
    </footer>
  )
}

/**
 * The social icons (PR-16, owner): ONE evenly spaced row, each icon drawn at
 * 32px inside its 44px tap target — a full set of seven (Google added, PR-20) is 7 × 44px + 2px gaps = 320px, which
 * fits one row on a 360px phone, and one row on desktop too (PR-17 G.4 — the
 * brand column is 21rem wide there). WhatsApp carries its own label and rel.
 */
function SocialRow({ socials, oneRow = false }: { socials: SocialLink[]; oneRow?: boolean }) {
  if (socials.length === 0) return null
  return (
    <ul className={`mt-2 flex items-center ${oneRow ? 'flex-nowrap gap-1' : 'flex-wrap gap-0.5'}`} data-social-row={oneRow ? 'desktop' : 'mobile'}>
      {socials.map((s) => (
        <li key={s.name}>
          <a
            href={s.href}
            target="_blank"
            rel={s.rel ?? 'noopener noreferrer me'}
            aria-label={s.label ?? `TutorMint on ${s.name}`}
            className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
          >
            <Image src={s.icon} alt="" width={2048} height={2048} sizes="32px" className="h-8 w-8 object-contain" />
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
              {links.map((l) => {
          if (l.memberDashboard) return <MemberDashboardLink key="dashboard" label={l.label} className={MOBILE_LINK} />
          const item = (
            <li key={l.href + l.label}>
              <Link
                prefetch={false}
                href={l.href}
                className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
              >
                {l.label}
              </Link>
            </li>
          )
          const shown = l.guestOnly ? <GuestOnly key={l.href + l.label}>{item}</GuestOnly> : item
          return l.hideOnHome ? <HideOnHome key={l.href + l.label}>{shown}</HideOnHome> : shown
        })}
            </ul>
          </details>
        )
      })}
    </>
  )
}

/** Support & contact as a mobile accordion, matching the link sections. */
function MobileSupport({ support }: { support: { whatsapp: string | null; email: string | null } }) {
  return (
    <details className="group">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-tm-mint marker:content-['']">
        Support &amp; Contact
        <ChevronDown aria-hidden size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="pb-1 text-sm">
        <li className="flex min-h-[44px] items-center text-slate-400">{PUBLIC_LOCATION}</li>
        {support.whatsapp && (
          <li>
            <a
              href={whatsappHref(support.whatsapp) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center whitespace-nowrap text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
            >
              WhatsApp {formatSupportWhatsApp(support.whatsapp)}
            </a>
          </li>
        )}
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
            prefetch={false}
            href="/contact"
            className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
          >
            Contact us
          </Link>
        </li>
        <li>
          <Link
            prefetch={false}
            href="/support"
            className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
          >
            Help &amp; Support
          </Link>
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
const MOBILE_LINK =
  'flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint'
const DESKTOP_LINK = `${MOBILE_LINK} md:min-h-[28px]`

function FooterColumn({ heading, links, nowrap = false }: { heading: string; links: FooterLink[]; nowrap?: boolean }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">{heading}</h2>
      <ul className="mt-2 text-sm">
        {links.map((l) => {
          if (l.memberDashboard) return <MemberDashboardLink key="dashboard" label={l.label} className={`${DESKTOP_LINK} ${nowrap ? 'whitespace-nowrap' : ''}`} />
          const item = (
            <li key={l.href + l.label}>
              <Link
                prefetch={false}
                href={l.href}
                className={`${DESKTOP_LINK} ${nowrap ? 'whitespace-nowrap' : ''}`}
              >
                {l.label}
              </Link>
            </li>
          )
          const shown = l.guestOnly ? <GuestOnly key={l.href + l.label}>{item}</GuestOnly> : item
          return l.hideOnHome ? <HideOnHome key={l.href + l.label}>{shown}</HideOnHome> : shown
        })}
      </ul>
    </div>
  )
}
