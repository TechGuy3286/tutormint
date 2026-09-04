import Link from 'next/link'
import type { Metadata } from 'next'
import Breadcrumbs from '@/components/Breadcrumbs'
import { getCompany } from '@/lib/company'
import { pageDescription, pageTitle, SLOGAN } from '@/lib/seo'

// About, and the legal identity.
//
// This page previously described a product we do not have: a "live 60-second
// video introduction", "starting bonus application credits", and a mission
// statement about eliminating fake credentials that overstated what a document
// review can establish. Rule 7 forbids mock data in shipped pages, and an
// invented product claim on a public page is the same defect wearing a suit.
//
// What it says now is what the code does. The entity block comes from
// app_settings, so the SECP number and NTN can be filled in without a deploy.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: pageTitle('About us'),
  description: pageDescription(
    'Who runs TutorMint, where we are registered, and how we make money without taking a cut of your fee',
  ),
  alternates: { canonical: '/about' },
}

export default async function AboutPage() {
  const company = await getCompany()

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'About' }]} />

      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">About TutorMint</h1>
        <p className="text-sm font-bold text-tm-green-deep">{SLOGAN}</p>
      </header>

      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-slate-700 sm:p-5">
        <p>
          TutorMint connects parents, schools and academies in Pakistan with{' '}
          <Link href="/browse/tutors" className="font-bold text-tm-red hover:underline">
            tutors who have been checked before they are listed
          </Link>
          . We are not an agency and we do not place anyone: parents search, read profiles and
          choose for themselves, and they talk to the tutor directly. Tutors find work the same
          way, on the{' '}
          <Link href="/browse/tuitions" className="font-bold text-tm-red hover:underline">
            open tuitions board
          </Link>
          .
        </p>

        <div className="space-y-2">
          <h2 className="text-base font-black text-tm-navy">We take nothing from the fee</h2>
          <p>
            A home-tuition academy typically keeps half of the first month and often a share of
            every month after it. On a Rs 20,000 tuition that is Rs 10,000 gone before the first
            class. TutorMint takes 0% — the fee a parent agrees with a tutor goes to the tutor, and
            we never handle it. Our only income is a monthly membership —{' '}
            <Link href="/tutor/packages" className="font-bold text-tm-red hover:underline">
              for tutors
            </Link>{' '}
            and{' '}
            <Link href="/parent/packages" className="font-bold text-tm-red hover:underline">
              for parents
            </Link>{' '}
            — bought by people who choose to buy one. It is not refundable, which the{' '}
            <Link href="/terms" className="font-bold text-tm-red hover:underline">
              Terms
            </Link>{' '}
            say before anybody pays.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-base font-black text-tm-navy">What verification means here</h2>
          <p>
            Every tutor uploads an introduction video and their degree certificates. The video goes
            to our own channel as a private video and an administrator reviews it, along with the
            documents, before the tutor is listed.{' '}
            <Link href="/parent/verify" className="font-bold text-tm-red hover:underline">
              Parents verify their CNIC and a home address
            </Link>{' '}
            before they can post a job, because a tutor is being asked to travel to a
            stranger&apos;s house.
          </p>
          <p>
            We are careful about what that proves. It means the person in the profile is the person
            in the documents. It does not mean we have watched them teach, and we do not promise
            results —{' '}
            <Link href="/faq" className="font-bold text-tm-red hover:underline">
              the FAQ
            </Link>{' '}
            says exactly where the line is.
          </p>
        </div>
      </section>

      {/* The legal identity. Everything here comes from app_settings, so the
          two numbers we do not have yet can be filled in by an admin with no
          deploy. They render as placeholders until then rather than as a blank
          space, which would read as an oversight. */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-slate-700 sm:p-5">
        <h2 className="text-base font-black text-tm-navy">Company details</h2>
        <p>
          TutorMint is a trading name of <strong className="text-tm-navy">{company.legalName}</strong>, a
          company incorporated in Pakistan and registered with the Securities and Exchange
          Commission of Pakistan.
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">Registered office</dt>
          <dd>{company.address}</dd>

          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">Email</dt>
          <dd>
            <a href={`mailto:${company.email}`} className="font-bold text-tm-red hover:underline">
              {company.email}
            </a>
          </dd>

          {/* Shown only once the number is real -- see LegalDoc's
              entitySection for why a printed {{COMPANY_REG_NO}} was worse
              than an absent row. */}
          {!company.regNoPending && (
            <>
              <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">
                SECP registration
              </dt>
              <dd>{company.regNo}</dd>
            </>
          )}

          {!company.ntnPending && (
            <>
              <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">NTN</dt>
              <dd>{company.ntn}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/browse/tutors"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-green-deep px-5 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
        >
          Find tutors
        </Link>
        <Link
          href="/browse/tuitions"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-navy px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
        >
          Find tuitions
        </Link>
        <Link
          href="/support"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
        >
          Contact us
        </Link>
      </section>
    </main>
  )
}
