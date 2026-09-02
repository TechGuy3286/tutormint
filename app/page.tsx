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
      <section className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-12 pb-16 text-center sm:px-6 sm:pt-16 sm:pb-24">
        {/* Eyebrow pill */}
        <p className="rounded-full border border-tm-green-deep/20 bg-tm-tint-green px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-tm-navy sm:text-xs sm:tracking-[0.18em]">
          Pakistan&rsquo;s Largest Verified Tutors &amp; Teachers Network
        </p>

        {/* HIRE */}
        <p className="mt-8 text-4xl font-black tracking-[0.18em] text-tm-green-deep sm:mt-10 sm:text-6xl">
          HIRE
        </p>

        {/* Headline. One <h1> for the page, with the line break the design
            uses on desktop and natural wrapping on a phone. */}
        <h1 className="tm-headline mt-3 text-3xl font-black leading-[1.15] text-tm-black sm:mt-4 sm:text-5xl md:text-6xl">
          Trusted, Degree-Verified{' '}
          <span className="whitespace-nowrap">
            Tutors/Teachers <span className="text-tm-red">FREE</span>
          </span>
        </h1>

        <p className="mt-4 text-sm font-bold italic text-tm-red sm:mt-5 sm:text-base">
          No Fee &bull; No Commission &bull; No Middleman &bull; Live Demo
        </p>

        {/* The two calls to action. Stacked below 640px, side by side above --
            the one responsive change the lock permits. */}
        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-5 sm:mt-14 sm:grid-cols-2">
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

  return (
    <Link
      href={href}
      className={`group flex min-h-[132px] flex-col justify-between rounded-2xl p-6 text-left text-white shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-[176px] sm:p-7 ${surface}`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
        {icon}
      </span>
      <span className="mt-6 text-lg font-bold sm:text-xl">{label}</span>
    </Link>
  )
}
