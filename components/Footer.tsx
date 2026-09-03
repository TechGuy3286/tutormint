// components/Footer.tsx — the compact black footer from
// design/reference/homepage.png.
//
// It lives in the root layout, so this is the footer on every page: brand
// column, four link columns, social row, and the "Verified Secure Platform"
// line.
//
// DENSITY, authorised 3 Sep 2026. It measured 1376px tall at 390px wide --
// larger than the phone viewport it sat under, and 64% of the whole
// homepage document. The cause was one column: four link lists stacked into
// a single strip, each link a 44px touch target. The links now sit in a
// 2-column grid on mobile, which halves that height without shrinking a
// single tap target, and the bands around them are tighter. Every link, the
// social icons and the legal line are unchanged.
//
// NO DATABASE READ HERE, deliberately. A cookies()-backed Supabase call in a
// component rendered by the root layout opts every route in the app into
// dynamic rendering, including the static legal and marketing pages. Contacts
// come from the environment via supportContactFromEnv(); /support keeps the
// app_settings-backed version. See lib/support.ts.
//
// Nothing is hardcoded: the support email, the WhatsApp number and the five
// social profiles are all environment-configured, and a channel with nothing
// set is not rendered rather than shown as a dead link (CLAUDE.md rule 7).

import Link from 'next/link'
import { supportContactFromEnv } from '@/lib/support'

type SocialLink = { name: string; icon: string; href: string }

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

export default function Footer() {
  const support = supportContactFromEnv()
  const socials = socialLinks()
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto bg-tm-black text-slate-300">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-5 lg:gap-8">
          {/* Brand */}
          <div className="lg:pr-4">
            <img
              src="/TutorMint-Footer-Logo-2448x752.png"
              alt="TutorMint"
              width={2448}
              height={752}
              className="h-8 w-auto object-contain"
            />
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-slate-400">
              Pakistan&rsquo;s Largest 100% Verified Tutors Network. 0% commission.
            </p>

            {socials.length > 0 && (
              <ul className="mt-3 flex flex-wrap items-center gap-1">
                {socials.map((s) => (
                  <li key={s.name}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer me"
                      aria-label={`TutorMint on ${s.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint"
                    >
                      <img src={s.icon} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The four link lists. Two columns on a phone rather than one
              long strip: same links, same 44px targets, half the height.
              `contents` at lg hands them back to the 5-column desktop grid,
              so the approved desktop layout is unchanged. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 lg:contents">
          <FooterColumn
            heading="For Tutors"
            links={[
              { label: 'Sign Up', href: '/register' },
              { label: 'Login', href: '/login' },
              { label: 'Dashboard', href: '/tutor/dashboard' },
              { label: 'Packages', href: '/tutor/packages' },
            ]}
          />

          <FooterColumn
            heading="For Parents"
            links={[
              { label: 'Sign Up', href: '/register' },
              { label: 'Login', href: '/login' },
              { label: 'Dashboard', href: '/parent/dashboard' },
              { label: 'Packages', href: '/parent/packages' },
            ]}
          />

          <FooterColumn
            heading="Trust & Legal"
            links={[
              { label: 'About Us', href: '/about' },
              { label: 'Blog & Guides', href: '/blog' },
              { label: 'FAQs', href: '/faq' },
              { label: 'Privacy Policy', href: '/privacy' },
              { label: 'Terms of Service', href: '/terms' },
            ]}
          />

          {/* Support & contact */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">
              Support &amp; Contact
            </h2>
            <ul className="mt-2 space-y-0.5 text-sm">
              <li className="flex min-h-[44px] items-center text-slate-400 md:min-h-[30px]">
                Lahore, Pakistan
              </li>
              {support.email && (
                <li>
                  <a
                    href={`mailto:${support.email}`}
                    className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[30px]"
                  >
                    {support.email}
                  </a>
                </li>
              )}
              <li>
                <Link
                  href="/support"
                  className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[30px]"
                >
                  Help &amp; Support
                </Link>
              </li>
              <li className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-tm-mint md:min-h-[30px]">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-tm-mint" />
                Verified Secure Platform
              </li>
            </ul>
          </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-1 border-t border-white/10 pt-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          {/* The legal entity, not the brand. CLAUDE.md's "Legal entity"
              section confines "Tutor Mint (Pvt) Ltd" to legal contexts, and
              the footer copyright line is named as one of them. */}
          <p>&copy; {year} Tutor Mint (Pvt) Ltd. All rights reserved.</p>
          <p>Empowering education across Pakistan.</p>
        </div>
      </div>
    </footer>
  )
}

/**
 * One link column.
 *
 * Tap targets are 44px on touch-sized viewports and tighten to 30px from md up.
 * CLAUDE.md's 44px floor exists for thumbs; holding it at every width would
 * double the height of the footer the design locks, and a desktop pointer does
 * not need it. WCAG 2.5.8's own minimum is 24px.
 */
function FooterColumn({
  heading,
  links,
}: {
  heading: string
  links: { label: string; href: string }[]
}) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-tm-mint">{heading}</h2>
      <ul className="mt-2 space-y-0.5 text-sm">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="flex min-h-[44px] items-center text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mint md:min-h-[30px]"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
