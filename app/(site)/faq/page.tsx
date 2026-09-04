import Link from 'next/link'
import type { Metadata } from 'next'
import Breadcrumbs from '@/components/Breadcrumbs'
import { FAQ_GROUPS, FAQ_ITEMS } from '@/lib/faqContent'
import { faqJsonLd, jsonLdScript, pageDescription, pageTitle } from '@/lib/seo'

// The help page, rebuilt around the questions people actually ask.
//
// What it replaced answered five questions, three of which described a product
// we do not have: a "live 60-second video introduction" (the video is uploaded
// and reviewed, not live), a "matching and support team" that connects parents
// to tutors (nobody does that — parents choose and message directly), and
// "starting bonus application credits" (there are none). A help page that
// describes the wrong product is worse than no help page: it is where somebody
// goes when they are already confused.
//
// The answers live in lib/faqContent.ts so that the FAQPage JSON-LD and the
// visible page are literally the same strings. Structured data that says
// something the page does not is a manual-action risk, and it is how a promise
// nobody made ends up in a search result.

export const metadata: Metadata = {
  title: pageTitle('Questions and answers'),
  description: pageDescription(
    'What a home tutor costs, how tutors are verified, online versus in person, and what we take from your fee (nothing)',
  ),
  alternates: { canonical: '/faq' },
}

export default function FAQPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(FAQ_ITEMS))} />

      <Breadcrumbs items={[{ label: 'Questions and answers' }]} />

      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">Questions and answers</h1>
        <p className="text-sm leading-relaxed text-slate-700">
          What we take from your fee (nothing), how tutors are checked, and what a membership
          actually buys. If something here is not clear, say so on{' '}
          <Link href="/support" className="font-bold text-tm-red hover:underline">
            our support page
          </Link>
          .
        </p>
      </header>

      <nav className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="pb-2 text-xs font-black uppercase tracking-wide text-gray-500">Jump to</h2>
        <ul className="grid gap-1 sm:grid-cols-2">
          {FAQ_GROUPS.map((g) => (
            <li key={g.id}>
              <a
                href={`#${g.id}`}
                className="flex min-h-[44px] items-center text-sm font-bold leading-relaxed text-tm-navy hover:text-tm-red"
              >
                {g.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {FAQ_GROUPS.map((group) => (
        <section key={group.id} id={group.id} className="scroll-mt-6 space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-base font-black text-tm-navy">{group.heading}</h2>
            <p className="text-xs text-gray-500">{group.blurb}</p>
          </div>

          <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {group.items.map((item) => (
              <article
                key={item.q}
                className="space-y-1.5 p-4 sm:p-5"
                // Roman Urdu is Urdu written in Latin script, so it stays
                // left-to-right and takes ur-Latn rather than ur -- tagging it
                // `ur` would tell a screen reader and a translation tool to
                // treat it as RTL Arabic script, which it is not.
                lang={item.lang === 'ur' ? 'ur-Latn' : undefined}
              >
                <h3 className="text-sm font-black text-tm-navy">{item.q}</h3>
                <p className="text-sm leading-relaxed text-slate-700">{item.a}</p>
                {item.links && item.links.length > 0 && (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                    {item.links.map((l) => (
                      <li key={l.href + l.label}>
                        <Link
                          href={l.href}
                          className="inline-flex min-h-[32px] items-center text-xs font-bold text-tm-red hover:underline"
                        >
                          {l.label} &rarr;
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-black text-tm-navy">Still stuck?</h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Support answers on WhatsApp and by email. The{' '}
          <Link href="/terms" className="font-bold text-tm-red hover:underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="font-bold text-tm-red hover:underline">
            Privacy Policy
          </Link>{' '}
          say the same things in more detail, including the no-refund policy.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/support"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-slate-700"
          >
            Contact support
          </Link>
          <Link
            href="/browse/tutors"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            Browse tutors
          </Link>
          {/* /tutor/register is a redirect stub to /register, kept alive
              because referral links already circulating on WhatsApp point at
              it. This page is the reason it is still routed at all. */}
          <Link
            href="/tutor/register"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            Sign up as a tutor
          </Link>
        </div>
      </section>
    </main>
  )
}
