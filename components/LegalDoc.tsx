import Breadcrumbs from '@/components/Breadcrumbs'
import type { Company } from '@/lib/company'
import Link from 'next/link'

// Shared chrome for /terms and /privacy.
//
// Both documents are long, both are read on a phone, and both are read by
// someone looking for one specific paragraph — usually about refunds or about
// their CNIC. So: numbered sections with anchors they can be linked to, a
// contents list at the top, and text at a readable size rather than the 11px
// grey that legal pages default to. A policy nobody can read is not a policy.

export type LegalSection = {
  id: string
  heading: string
  body: React.ReactNode
}

/**
 * The registered-entity section, shared by /terms and /privacy.
 *
 * One definition for both, because the address and the two identifiers must
 * say the same thing in both documents — two copies is how a Terms page and a
 * Privacy page end up naming different registered offices.
 *
 * Every value comes from app_settings (lib/company.ts). The SECP number and
 * the NTN do not exist yet and render as their placeholders; an admin fills
 * them in with no deploy. NO STATUTE IS NAMED anywhere in either document —
 * Pakistan's data-protection legislation has been in draft for years, and
 * citing an act we have not had checked would read as authority these drafts
 * do not have.
 */
export function entitySection(company: Company): LegalSection {
  return {
    id: 'entity',
    heading: 'Who you are contracting with',
    body: (
      <>
        <p>
          TutorMint is a trading name of <strong>{company.legalName}</strong>, a company
          incorporated in Pakistan and registered with the Securities and Exchange Commission of
          Pakistan. When this document says &quot;we&quot; or &quot;us&quot;, it means that
          company.
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Registered office
          </dt>
          <dd>{company.address}</dd>

          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">Email</dt>
          <dd>
            <a href={`mailto:${company.email}`}>{company.email}</a>
          </dd>

          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">
            SECP registration number
          </dt>
          <dd className={company.regNoPending ? 'text-gray-500' : undefined}>{company.regNo}</dd>

          <dt className="text-xs font-bold uppercase tracking-wide text-gray-500">
            National Tax Number
          </dt>
          <dd className={company.ntnPending ? 'text-gray-500' : undefined}>{company.ntn}</dd>
        </dl>
        <p>
          Notices under this document may be sent to that address or to that email. The brand is
          written &quot;TutorMint&quot; everywhere on the site; the two-word form appears only in
          the registered company name, which is what it is.
        </p>
      </>
    ),
  }
}

export default function LegalDoc({
  title,
  updated,
  intro,
  sections,
}: {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
}) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: title }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">{title}</h1>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Last updated {updated}
        </p>
        <p className="text-sm leading-relaxed text-slate-700">{intro}</p>
      </header>

      <nav className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="pb-2 text-xs font-black uppercase tracking-wide text-gray-500">Contents</h2>
        <ol className="space-y-1.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex min-h-[44px] items-center gap-2 text-sm leading-relaxed text-slate-700 hover:text-tm-red"
              >
                <span className="shrink-0 font-bold text-gray-500">{i + 1}.</span>
                <span>{s.heading}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-5">
        {sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"
          >
            <h2 className="text-base font-black text-tm-navy">
              <span className="text-gray-500">{i + 1}.</span> {s.heading}
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-slate-700 [&_a]:font-bold [&_a]:text-tm-red [&_a:hover]:underline [&_li]:pl-1 [&_strong]:text-tm-navy [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
              {s.body}
            </div>
          </section>
        ))}
      </div>

      <footer className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
        Questions about this document? <Link href="/support">Contact us</Link>. See also our{' '}
        <Link href="/terms">Terms of Service</Link> and{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </footer>
    </main>
  )
}
