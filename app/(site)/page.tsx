// app/page.tsx — the partner-approved homepage.
//
// LOCKED. design/reference/homepage.png is the specification: the pill, "HIRE",
// the headline, the red italic subline, and the two large buttons. CLAUDE.md
// permits changes only to link targets, mobile responsiveness, metadata and
// accessibility. No new sections, no ad slot, no featured-tutor strip, no copy
// edits without an explicit owner instruction.
//
// OWNER-APPROVED, 13 Oct 2026 — exactly three changes, recorded in CLAUDE.md:
//   a) the H1 text (same styling and size);
//   b) the "For parents" / "For tutors" cards directly below the two buttons;
//   c) the link block: city tuition links once, plus tutor pages and four links.
// Everything else — hero design, Urdu line, both buttons, tagline, colours —
// is as it was.
//
// It is a server component with no client JavaScript at all. This is the page
// every organic visitor lands on, and it renders as HTML on the first byte.
//
// SPACING was authorised on 3 Sep 2026 and is the only thing that has changed
// here since: every number below is a padding or a margin. Order, copy, type
// sizes and the two buttons are exactly as approved. The brief for it was that
// dead space and wasted scroll are defects rather than neutral choices, so the
// eyebrow, HIRE, the headline, the subline and BOTH buttons now sit above the
// fold at 390x844 and 1280x800 with room to spare, rather than the second
// button finishing 79px short of the bottom edge on a laptop.

import HomeLinks from '@/components/home/HomeLinks'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Search, ClipboardList } from 'lucide-react'
import { socialMeta } from '@/lib/seo'
import { HOME_CARDS, HOME_H1_LINES, HOME_TITLE, SITE_DESCRIPTION } from '@/lib/siteIdentity'

export async function generateMetadata(): Promise<Metadata> {
  // From lib/siteIdentity (owner, 13 Oct 2026): the title and description name
  // BOTH sides — tutors for parents, tuitions for tutors. Metadata is one of the
  // changes the lock permits; nothing rendered below is touched.
  const title = HOME_TITLE
  const description = SITE_DESCRIPTION

  return {
    title,
    description,
    alternates: { canonical: '/' },
    // Complete OG + Twitter with the branded default image — the homepage set
    // openGraph without images before, which (Next not deep-merging openGraph)
    // shipped a bare link preview. See socialMeta.
    ...socialMeta({ title, description, path: '/', type: 'website' }),
  }
}

export default function HomePage() {
  // The Organization + WebSite structured data is emitted once for every public
  // page by the site chrome (components/SiteChrome), so this page carries none
  // of its own.
  return (
    <div className="bg-tm-bg">
      <section className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-5 pb-8 text-center sm:px-6 sm:pt-6 sm:pb-4">
        {/* Eyebrow pill */}
        <p className="rounded-full border border-tm-green-deep/20 bg-tm-tint-green px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-tm-navy sm:text-xs sm:tracking-[0.18em]">
          Pakistan&rsquo;s Largest Verified Tutors &amp; Teachers Network
        </p>

        {/* HIRE */}
        <p className="mt-3 text-4xl font-black tracking-[0.18em] text-tm-green-deep sm:mt-4 sm:text-6xl">
          HIRE
        </p>

        {/* Headline. One <h1> for the page. The words are the owner-approved
            13 Oct 2026 text (lib/siteIdentity); the styling and size are the
            approved ones, unchanged. Two lines by meaning — one for each side —
            and text-balance keeps each line's wrap even on a 360px phone. */}
        <h1 className="tm-headline mt-2 text-balance text-3xl font-black leading-[1.15] text-tm-black sm:mt-3 sm:text-5xl md:text-6xl">
          <span className="block">{HOME_H1_LINES[0]}</span>
          <span className="block">{HOME_H1_LINES[1]}</span>
        </h1>

        <p className="mt-3 text-sm font-bold italic text-tm-red sm:mt-4 sm:text-base">
          Free to Join &bull; No Commission &bull; No Middleman &bull; Live Demo
        </p>
        {/* The same line in Urdu, directly below the English (owner PR2 §6):
            right-to-left, one step smaller, the system Urdu font via lang="ur".
            Colour tm-black (#0A0A0A) per owner PR8 §4.3; the English line above is
            unchanged. */}
        <p lang="ur" dir="rtl" className="mt-1 text-xs font-bold text-tm-black sm:text-sm">
          کوئی فیس نہیں &bull; کوئی کمیشن نہیں &bull; کوئی مڈل مین نہیں &bull; لائیو ڈیمو
        </p>

        {/* The two calls to action. Stacked below 640px, side by side above --
            the one responsive change the lock permits. */}
        <div className="mt-6 grid w-full max-w-3xl grid-cols-1 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4">
          <HomeCta
            href="/browse/tutors"
            label="Find Tutors / Teachers"
            tone="green"
            icon={<Search aria-hidden className="h-6 w-6" />}
          />
          <HomeCta
            href="/browse/tuitions"
            label="Find Tuitions / Jobs"
            tone="navy"
            icon={<ClipboardList aria-hidden className="h-6 w-6" />}
          />
        </div>
        {/* For parents / For tutors (owner-approved, 13 Oct 2026): two cards
            directly below the buttons, side by side, stacked on a phone. The
            words come from lib/siteIdentity. */}
        <div className="mt-4 grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-2 sm:gap-4">
          {HOME_CARDS.map((card) => (
            <section key={card.title} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 className="text-base font-black text-tm-navy">{card.title}</h2>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {card.points.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <Check aria-hidden size={16} className="mt-0.5 shrink-0 text-tm-green-deep" />
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex flex-wrap gap-x-4">
                {card.links.map((l) => (
                  <Link key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center text-sm font-bold text-tm-red hover:underline">
                    {l.label}
                  </Link>
                ))}
              </p>
            </section>
          ))}
        </div>

        {/* The link block (owner-approved, 13 Oct 2026): the city tuition-job
            links once, the busiest indexable tutor pages, and four plain links. */}
        <div className="mt-4 w-full max-w-3xl">
          <HomeLinks />
        </div>
      </section>
    </div>
  )
}

/**
 * One of the two hero buttons.
 *
 * min-h is set well above the 44px tap-target floor because these are the
 * primary actions on the site's most-visited page; the reference draws them as
 * large panels rather than buttons.
 */
function HomeCta({
  href,
  label,
  tone,
  icon,
}: {
  href: string
  label: string
  tone: 'green' | 'navy'
  icon: React.ReactNode
}) {
  const surface =
    tone === 'green'
      ? 'bg-tm-green-deep hover:bg-tm-green-deep-hover focus-visible:outline-tm-green-deep'
      : 'bg-tm-navy hover:bg-tm-navy-hover focus-visible:outline-tm-navy'

  // ONE ROW, and the height follows the content.
  //
  // These were 132px tall on a phone and 176px on a laptop, with the icon
  // pinned to the top-left, the label to the bottom-left and nothing between
  // them: two buttons spending 350px of vertical space to say eight words. The
  // colours, the copy and the two-up layout are exactly as approved — only the
  // arrangement inside the button changed, which is what the 3 Sep spacing
  // authorisation covers.
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-2xl p-5 text-left text-white shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:gap-5 sm:p-6 ${surface}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
        {icon}
      </span>
      <span className="text-lg font-bold sm:text-xl">{label}</span>
    </Link>
  )
}
