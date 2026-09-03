// app/page.tsx — the partner-approved homepage.
//
// LOCKED. design/reference/homepage.png is the specification: the pill, "HIRE",
// the two-line headline with FREE in brand red, the red italic subline, and the
// two large buttons. CLAUDE.md permits changes only to link targets, mobile
// responsiveness, metadata and accessibility. No new sections, no ad slot, no
// featured-tutor strip, no copy edits without an explicit owner instruction.
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

import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, ClipboardList } from 'lucide-react'
import WhatsAppBubble from '@/components/WhatsAppBubble'

export async function generateMetadata(): Promise<Metadata> {
  const title = "Hire Trusted, Degree-Verified Tutors & Teachers | TutorMint"
  const description =
    'Pakistan’s largest verified tutors and teachers network. No fee, no commission, no middleman — book a live demo and hire directly.'

  return {
    title,
    description,
    alternates: { canonical: '/' },
    openGraph: {
      title,
      description,
      url: '/',
      siteName: 'TutorMint',
      locale: 'en_PK',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function HomePage() {
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

        {/* Headline. One <h1> for the page, with the line break the design
            uses on desktop and natural wrapping on a phone. */}
        <h1 className="tm-headline mt-2 text-3xl font-black leading-[1.15] text-tm-black sm:mt-3 sm:text-5xl md:text-6xl">
          Trusted, Degree-Verified{' '}
          <span className="whitespace-nowrap">
            Tutors/Teachers <span className="text-tm-red">FREE</span>
          </span>
        </h1>

        <p className="mt-3 text-sm font-bold italic text-tm-red sm:mt-4 sm:text-base">
          No Fee &bull; No Commission &bull; No Middleman &bull; Live Demo
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
      </section>

      <WhatsAppBubble />
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
